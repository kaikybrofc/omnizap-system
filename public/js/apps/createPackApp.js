import { React, createRoot, useMemo, useState, useEffect } from '../runtime/react-runtime.js';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(React.createElement);
const CREATE_PACK_DRAFT_KEY = 'omnizap_create_pack_draft_v1';
const CREATE_PACK_DRAFT_MAX_CHARS = 3_500_000;
const PACK_UPLOAD_TASK_KEY = 'omnizap_pack_upload_task_v1';
const MAX_MANUAL_TAGS = 8;
const DEFAULT_SUGGESTED_TAGS = ['anime', 'meme', 'game', 'texto', 'nsfw', 'dark', 'cartoon', 'foto-real', 'cyberpunk'];

const DEFAULT_LIMITS = {
  pack_name_max_length: 120,
  publisher_max_length: 120,
  description_max_length: 1024,
  stickers_per_pack: 30,
  packs_per_owner: 50,
  sticker_upload_max_bytes: 2 * 1024 * 1024,
  sticker_upload_source_max_bytes: 20 * 1024 * 1024,
};
const UPLOAD_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

const STEPS = [
  { id: 1, title: 'Informações' },
  { id: 2, title: 'Stickers' },
  { id: 3, title: 'Publicação' },
];

const clampText = (value, maxLength) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const sanitizePackName = (value, maxLength = 120) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, maxLength);

const toBytesLabel = (bytes) => `${Math.round(Number(bytes || 0) / 1024)} KB`;
const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');
const isValidPhone = (value) => {
  const digits = normalizePhoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
};
const normalizeTag = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const mergeTags = (...groups) => {
  const seen = new Set();
  const ordered = [];
  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      const normalized = normalizeTag(entry);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      ordered.push(normalized);
    }
  }
  return ordered;
};

const writeUploadTask = (payload) => {
  try {
    localStorage.setItem(
      PACK_UPLOAD_TASK_KEY,
      JSON.stringify({
        ...payload,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // ignore storage errors
  }
};

const clearCreatePackStorage = () => {
  try {
    localStorage.removeItem(CREATE_PACK_DRAFT_KEY);
    localStorage.removeItem(PACK_UPLOAD_TASK_KEY);
  } catch {
    // ignore storage errors
  }
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });

const uploadStickerWithProgress = ({ apiBasePath, packKey, editToken, item, setCover, onProgress }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBasePath}/${encodeURIComponent(packKey)}/stickers-upload`);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.timeout = UPLOAD_REQUEST_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percentage = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(percentage);
    };

    xhr.onerror = () => reject(new Error(`Falha de rede ao enviar ${item.file.name}.`));
    xhr.ontimeout = () => reject(new Error(`Timeout ao enviar ${item.file.name}. Tente novamente.`));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || '{}');
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      reject(new Error(payload?.error || `Falha no upload de ${item.file.name}.`));
    };

    const body = JSON.stringify({
      edit_token: editToken,
      sticker_data_url: item.dataUrl,
      set_cover: Boolean(setCover),
    });
    xhr.send(body);
  });

function StepPill({ step, active, done }) {
  return html`
    <div className=${`flex items-center gap-2 rounded-2xl border px-3 py-2 transition ${
      active
        ? 'border-accent/50 bg-accent/10 text-accent'
        : done
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
          : 'border-line bg-panelSoft text-slate-300'
    }`}>
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/30 text-xs font-extrabold">${done ? '✓' : step.id}</span>
      <p className="text-[11px] font-semibold">${step.title}</p>
    </div>
  `;
}

function FloatingField({ label, value, onChange, maxLength, hint = '', multiline = false }) {
  const used = String(value || '').length;
  const nearLimit = used >= maxLength * 0.85;
  const atLimit = used >= maxLength;
  const Tag = multiline ? 'textarea' : 'input';

  return html`
    <label className="block">
      <span className="mb-2 inline-block text-xs font-semibold text-slate-300">${label}</span>
      <div className="relative">
        <${Tag}
          className=${`w-full rounded-2xl border bg-panel/80 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-transparent ${
            atLimit ? 'border-rose-400/60 focus:border-rose-300' : 'border-line focus:border-accent/60'
          } ${multiline ? 'min-h-[110px] max-h-52 resize-none overflow-y-auto' : 'h-12'}`}
          placeholder=${label}
          value=${value}
          maxlength=${maxLength}
          onInput=${onChange}
        />
        <span className="pointer-events-none absolute left-4 top-[-9px] rounded-md bg-panel px-2 text-[10px] font-semibold uppercase tracking-[.08em] text-slate-400">${label}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">${hint}</span>
        <span className=${`${atLimit ? 'text-rose-300' : nearLimit ? 'text-amber-300' : 'text-slate-400'} font-semibold`}>${used}/${maxLength}</span>
      </div>
    </label>
  `;
}

function StickerThumb({ item, index, selectedCoverId, onSetCover, onRemove, onDragStart, onDropOn }) {
  return html`
    <article
      draggable=${true}
      onDragStart=${() => onDragStart(item.id)}
      onDragOver=${(e) => e.preventDefault()}
      onDrop=${() => onDropOn(item.id)}
      className="group relative overflow-hidden rounded-2xl border border-line bg-panelSoft"
    >
      ${item.mediaKind === 'video'
        ? html`<video src=${item.dataUrl} muted=${true} playsInline=${true} preload="metadata" className="aspect-square w-full object-cover bg-slate-900/80"></video>`
        : html`<img src=${item.dataUrl} alt=${item.file.name} className="aspect-square w-full object-contain bg-slate-900/80" />`}
      <span className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold">#${index + 1}</span>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-2">
        <button
          type="button"
          onClick=${() => onSetCover(item.id)}
          className=${`rounded-lg px-2 py-1 text-[10px] font-bold ${
            selectedCoverId === item.id ? 'bg-accent text-slate-900' : 'bg-white/15 text-slate-100'
          }`}
        >
          ${selectedCoverId === item.id ? 'Capa' : 'Definir capa'}
        </button>
        <button type="button" onClick=${() => onRemove(item.id)} className="rounded-lg bg-rose-500/80 px-2 py-1 text-[10px] font-bold text-white">Remover</button>
      </div>
    </article>
  `;
}

function CreatePackApp() {
  const root = document.getElementById('create-pack-react-root');
  const apiBasePath = root?.dataset?.apiBasePath || '/api/sticker-packs';
  const webPath = root?.dataset?.webPath || '/stickers';

  const [step, setStep] = useState(1);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [publisher, setPublisher] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [suggestedTags, setSuggestedTags] = useState(DEFAULT_SUGGESTED_TAGS);
  const [accountId, setAccountId] = useState('');
  const [files, setFiles] = useState([]);
  const [coverId, setCoverId] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [draggingStickerId, setDraggingStickerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [uploadMap, setUploadMap] = useState({});
  const [activeSession, setActiveSession] = useState(null);
  const [result, setResult] = useState(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const canStep2 = useMemo(
    () => sanitizePackName(name, limits.pack_name_max_length).length > 0 && isValidPhone(accountId),
    [name, accountId, limits.pack_name_max_length],
  );
  const canStep3 = useMemo(() => files.length > 0, [files.length]);
  const publishReady = canStep2 && canStep3 && !busy;
  const completionPercentage = Math.round((step / STEPS.length) * 100);
  const failedUploadsCount = useMemo(
    () => files.reduce((acc, item) => (uploadMap[item.id]?.status === 'error' ? acc + 1 : acc), 0),
    [files, uploadMap],
  );
  const pendingUploadsCount = useMemo(
    () => files.reduce((acc, item) => (uploadMap[item.id]?.status === 'done' ? acc : acc + 1), 0),
    [files, uploadMap],
  );
  const publishLabel =
    failedUploadsCount > 0 || (activeSession?.packKey && pendingUploadsCount < files.length)
      ? `🔁 Reenviar falhas (${failedUploadsCount})`
      : '🚀 Publicar Pack';

  const suggestedFromText = useMemo(() => {
    const haystack = `${name} ${description}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const selected = new Set(tags);
    const matches = [];

    for (const tag of suggestedTags) {
      const normalizedTag = normalizeTag(tag);
      if (!normalizedTag || selected.has(normalizedTag)) continue;
      const plain = normalizedTag.replace(/-/g, ' ');
      const directMatch = haystack.includes(plain) || haystack.includes(normalizedTag);
      if (directMatch) matches.push(normalizedTag);
    }

    if (matches.length >= 5) return matches.slice(0, 5);
    const fallback = suggestedTags.map((tag) => normalizeTag(tag)).filter((tag) => tag && !selected.has(tag));
    return mergeTags(matches, fallback).slice(0, 5);
  }, [name, description, suggestedTags, tags]);

  const preview = useMemo(() => {
    const safeName = sanitizePackName(name, limits.pack_name_max_length) || 'novopack';
    const safeDescription = clampText(description, limits.description_max_length);
    const preferredCover = files.find((item) => item.id === coverId) || files[0] || null;
    const imageFallback = files.find((item) => item.mediaKind !== 'video') || null;
    const cover = preferredCover?.mediaKind === 'video' ? imageFallback : preferredCover;
    return {
      name: safeName,
      description: safeDescription,
      publisher: clampText(publisher || 'OmniZap Creator', limits.publisher_max_length),
      coverUrl: cover?.dataUrl || 'https://iili.io/fSNGag2.png',
      stickerCount: files.length,
      visibility,
      tags: tags.slice(0, 3),
      fakeLikes: Math.max(12, files.length * 7 + 11),
      fakeOpens: Math.max(100, files.length * 55 + 70),
    };
  }, [name, description, publisher, files, coverId, visibility, limits.description_max_length, limits.pack_name_max_length, limits.publisher_max_length, tags]);

  const quality = useMemo(() => {
    const titleLength = sanitizePackName(name, limits.pack_name_max_length).length;
    const descriptionLength = clampText(description, limits.description_max_length).length;
    const titleScore = titleLength >= 6 ? 1 : titleLength >= 4 ? 0.7 : 0;
    const descriptionScore = descriptionLength >= 28 ? 1 : descriptionLength >= 14 ? 0.6 : 0;
    const tagsScore = Math.min(1, tags.length / 4);
    const stickersScore = Math.min(1, files.length / 12);
    const coverScore = coverId ? 1 : files.length ? 0.6 : 0;
    const finalScore = Math.round((titleScore * 0.28 + descriptionScore * 0.24 + tagsScore * 0.2 + stickersScore * 0.2 + coverScore * 0.08) * 100);
    if (finalScore >= 80) return { score: finalScore, label: 'Excelente', tone: 'text-emerald-300', bar: 'bg-emerald-400' };
    if (finalScore >= 60) return { score: finalScore, label: 'Bom', tone: 'text-amber-300', bar: 'bg-amber-400' };
    return { score: finalScore, label: 'Precisa melhorar', tone: 'text-rose-300', bar: 'bg-rose-400' };
  }, [name, description, tags.length, files.length, coverId, limits.pack_name_max_length, limits.description_max_length]);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${apiBasePath}/create-config`);
        if (!response.ok) throw new Error('Falha ao buscar configuração.');
        const payload = await response.json();
        const apiLimits = payload?.data?.limits || {};
        const apiSuggestions = payload?.data?.rules?.suggested_tags;
        setLimits((prev) => ({ ...prev, ...apiLimits }));
        if (Array.isArray(apiSuggestions) && apiSuggestions.length) {
          setSuggestedTags(mergeTags(apiSuggestions).slice(0, 20));
        }
      } catch {
        // keep default
      }
    };
    load();
  }, [apiBasePath]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CREATE_PACK_DRAFT_KEY);
      if (!raw) {
        setDraftLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        setDraftLoaded(true);
        return;
      }

      const restoredName = typeof parsed.name === 'string' ? sanitizePackName(parsed.name, DEFAULT_LIMITS.pack_name_max_length) : '';
      if (restoredName) setName(restoredName);
      if (typeof parsed.description === 'string') setDescription(parsed.description);
      if (typeof parsed.publisher === 'string') setPublisher(parsed.publisher);
      if (typeof parsed.visibility === 'string') setVisibility(parsed.visibility);
      if (typeof parsed.accountId === 'string') setAccountId(parsed.accountId);
      if (Array.isArray(parsed.tags)) setTags(mergeTags(parsed.tags).slice(0, MAX_MANUAL_TAGS));
      const parsedStep = Number.isFinite(Number(parsed.step)) ? Math.max(1, Math.min(3, Number(parsed.step))) : 1;

      let restoredCount = 0;
      if (Array.isArray(parsed.files)) {
        const restored = parsed.files
          .filter((item) => item && typeof item.dataUrl === 'string' && typeof item.name === 'string')
          .map((item) => ({
            id: String(item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
            file: {
              name: String(item.name || 'sticker.webp'),
              size: Number(item.size || 0),
              type: String(item.type || 'image/webp'),
            },
            mediaKind:
              String(item.type || '').toLowerCase().startsWith('video/') ||
              String(item.name || '').toLowerCase().match(/\.(mp4|webm|mov|m4v)$/i)
                ? 'video'
                : 'image',
            dataUrl: String(item.dataUrl),
          }));

        if (restored.length) {
          restoredCount = restored.length;
          setFiles(restored.slice(0, DEFAULT_LIMITS.stickers_per_pack));
          setUploadMap(
            restored.reduce((acc, item) => {
              acc[item.id] = { status: 'idle', progress: 0, name: item.file.name };
              return acc;
            }, {}),
          );
          const restoredCoverId = String(parsed.coverId || '');
          setCoverId(restored.find((item) => item.id === restoredCoverId)?.id || restored[0].id);
        }
      }
      if (parsed?.activeSession && typeof parsed.activeSession === 'object') {
        const packKey = String(parsed.activeSession.packKey || '').trim();
        const editToken = String(parsed.activeSession.editToken || '').trim();
        if (packKey && editToken) {
          setActiveSession({
            packKey,
            editToken,
            webUrl: String(parsed.activeSession.webUrl || '').trim() || null,
            created: parsed.activeSession.created && typeof parsed.activeSession.created === 'object' ? parsed.activeSession.created : null,
          });
        }
      }

      const normalizedStep = restoredCount === 0 ? Math.min(2, parsedStep) : parsedStep;
      setStep(normalizedStep);
      if (restoredCount > 0 || restoredName) {
        setStatus('Rascunho restaurado automaticamente.');
      }
    } catch {
      // ignore invalid drafts
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!draftLoaded || busy) return;

    const serializable = {
      step,
      name,
      description,
      publisher,
      visibility,
      accountId,
      tags,
      coverId,
      activeSession: activeSession?.packKey && activeSession?.editToken ? activeSession : null,
      files: files.map((item) => ({
        id: item.id,
        name: item?.file?.name || 'sticker.webp',
        size: Number(item?.file?.size || 0),
        type: String(item?.file?.type || 'image/webp'),
        dataUrl: item.dataUrl,
      })),
      updatedAt: Date.now(),
    };

    try {
      const raw = JSON.stringify(serializable);
      if (raw.length <= CREATE_PACK_DRAFT_MAX_CHARS) {
        localStorage.setItem(CREATE_PACK_DRAFT_KEY, raw);
      } else {
        const lighter = { ...serializable, step: Math.min(2, Number(serializable.step || 1)), coverId: '', files: [] };
        localStorage.setItem(CREATE_PACK_DRAFT_KEY, JSON.stringify(lighter));
      }
    } catch {
      // ignore storage errors
    }
  }, [draftLoaded, busy, step, name, description, publisher, visibility, accountId, tags, coverId, files, activeSession]);

  useEffect(() => {
    if (!draftLoaded) return;
    if (files.length > 0) return;
    try {
      const rawTask = localStorage.getItem(PACK_UPLOAD_TASK_KEY);
      if (!rawTask) return;
      const task = JSON.parse(rawTask);
      const statusValue = String(task?.status || '').toLowerCase();
      if (statusValue !== 'paused') return;
      localStorage.removeItem(PACK_UPLOAD_TASK_KEY);
      setStatus((prev) => prev || 'Envio pausado anterior foi limpo. Selecione os stickers novamente para continuar.');
    } catch {
      // ignore
    }
  }, [draftLoaded, files.length]);

  const addIncomingFiles = async (incoming) => {
    const raw = Array.from(incoming || []).filter(Boolean);
    if (!raw.length) return;

    const filtered = raw.filter((file) => {
      const lowerName = String(file.name || '').toLowerCase();
      const lowerType = String(file.type || '').toLowerCase();
      const isImage = lowerType.startsWith('image/');
      const isVideo =
        lowerType.startsWith('video/') ||
        lowerName.endsWith('.mp4') ||
        lowerName.endsWith('.webm') ||
        lowerName.endsWith('.mov') ||
        lowerName.endsWith('.m4v');
      if (!isImage && !isVideo) return false;
      const maxBytes = Number(limits.sticker_upload_source_max_bytes || 0);
      return Number(file.size || 0) <= maxBytes;
    });

    if (!filtered.length) {
      setError(
        `Envie imagem ou vídeo até ${toBytesLabel(
          limits.sticker_upload_source_max_bytes,
        )}. O sistema converte automaticamente para webp.`,
      );
      return;
    }

    const availableSlots = Math.max(0, Number(limits.stickers_per_pack || 30) - files.length);
    const selected = filtered.slice(0, availableSlots);
    if (!selected.length) {
      setError(`Seu pack pode ter até ${limits.stickers_per_pack} stickers.`);
      return;
    }

    setError('');
    const mapped = await Promise.all(
      selected.map(async (file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        mediaKind:
          String(file.type || '').toLowerCase().startsWith('video/') ||
          String(file.name || '').toLowerCase().match(/\.(mp4|webm|mov|m4v)$/i)
            ? 'video'
            : 'image',
        dataUrl: await fileToDataUrl(file),
      })),
    );

    setFiles((prev) => [...prev, ...mapped].slice(0, limits.stickers_per_pack));
    setUploadMap((prev) => {
      const next = { ...prev };
      for (const item of mapped) {
        next[item.id] = { status: 'idle', progress: 0, name: item.file.name };
      }
      return next;
    });

    if (!coverId && mapped[0]?.id) {
      setCoverId(mapped[0].id);
    }
  };

  const onDropUpload = async (event) => {
    event.preventDefault();
    setDragActive(false);
    await addIncomingFiles(event.dataTransfer?.files || []);
  };

  const removeSticker = (id) => {
    setFiles((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (id === coverId) {
        setCoverId(next[0]?.id || '');
      }
      return next;
    });
    setUploadMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const reorderStickers = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setFiles((prev) => {
      const fromIndex = prev.findIndex((item) => item.id === fromId);
      const toIndex = prev.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const clone = [...prev];
      const [moved] = clone.splice(fromIndex, 1);
      clone.splice(toIndex, 0, moved);
      return clone;
    });
  };

  const publishPack = async () => {
    const finalName = sanitizePackName(name, limits.pack_name_max_length);
    const finalPublisher = clampText(publisher || 'OmniZap Creator', limits.publisher_max_length);
    const finalDescription = clampText(description, limits.description_max_length);

    if (!finalName) {
      setError('Informe um nome válido para o pack.');
      setStep(1);
      return;
    }
    if (!isValidPhone(accountId)) {
      setError('Informe seu número de celular com DDD para publicar.');
      setStep(1);
      return;
    }
    if (!files.length) {
      setError('Adicione ao menos 1 sticker para publicar.');
      setStep(2);
      return;
    }

    setBusy(true);
    setError('');
    const doneBeforeRun = files.reduce((acc, item) => (uploadMap[item.id]?.status === 'done' ? acc + 1 : acc), 0);
    const pendingFiles = files.filter((item) => uploadMap[item.id]?.status !== 'done');
    if (!pendingFiles.length) {
      setBusy(false);
      setStatus('Todos os stickers já foram enviados.');
      return;
    }

    setProgress({ current: doneBeforeRun, total: files.length });
    setResult((prev) => prev);

    try {
      let session = activeSession;
      if (!session?.packKey || !session?.editToken) {
        setStatus('Criando pack...');
        writeUploadTask({
          status: 'running',
          title: 'Publicando pack',
          current: doneBeforeRun,
          total: files.length,
          progress: Math.round((doneBeforeRun / Math.max(1, files.length)) * 100),
          packKey: null,
          packUrl: null,
          message: 'Criando pack...',
        });

        const createResponse = await fetch(`${apiBasePath}/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            name: finalName,
            publisher: finalPublisher,
            description: finalDescription,
            tags,
            visibility,
            owner_jid: clampText(accountId, 64),
          }),
        });

        const createPayload = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok) throw new Error(createPayload?.error || 'Não foi possível criar o pack.');

        const created = createPayload?.data || {};
        const editToken = String(createPayload?.meta?.edit_token || '').trim();
        const packKey = String(created?.pack_key || '').trim();
        if (!editToken || !packKey) throw new Error('Resposta de criação inválida.');
        session = {
          packKey,
          editToken,
          webUrl: created?.web_url || `${webPath}/${packKey}`,
          created,
        };
        setActiveSession(session);
        setResult(created);
      }

      setStatus('Enviando stickers...');
      writeUploadTask({
        status: 'running',
        title: 'Publicando pack',
        current: doneBeforeRun,
        total: files.length,
        progress: Math.round((doneBeforeRun / Math.max(1, files.length)) * 100),
        packKey: session.packKey,
        packUrl: session.webUrl,
        message: 'Enviando stickers...',
      });
      setUploadMap((prev) => {
        const next = { ...prev };
        for (const item of pendingFiles) {
          next[item.id] = { ...(next[item.id] || {}), status: 'uploading', progress: 0, error: '' };
        }
        return next;
      });

      const hasVideoPending = pendingFiles.some((item) => item.mediaKind === 'video');
      const concurrency = hasVideoPending
        ? 1
        : Math.max(2, Math.min(4, Number(window.navigator?.hardwareConcurrency || 3)));
      let cursor = 0;
      let processed = doneBeforeRun;
      let failedCount = 0;

      const runWorker = async () => {
        while (cursor < pendingFiles.length) {
          const index = cursor;
          cursor += 1;
          const item = pendingFiles[index];

          try {
            await uploadStickerWithProgress({
              apiBasePath,
              packKey: session.packKey,
              editToken: session.editToken,
              item,
              setCover: item.id === coverId,
              onProgress: (percentage) => {
                setUploadMap((prev) => ({
                  ...prev,
                  [item.id]: { ...(prev[item.id] || {}), status: 'uploading', progress: percentage, error: '' },
                }));
                writeUploadTask({
                  status: 'running',
                  title: 'Publicando pack',
                  current: processed,
                  total: files.length,
                  progress: Math.round(((processed + percentage / 100) / Math.max(1, files.length)) * 100),
                  packKey: session.packKey,
                  packUrl: session.webUrl,
                  message: `Enviando ${item.file.name}`,
                });
              },
            });
            setUploadMap((prev) => ({
              ...prev,
              [item.id]: { ...(prev[item.id] || {}), status: 'done', progress: 100, error: '' },
            }));
          } catch (err) {
            failedCount += 1;
            setUploadMap((prev) => ({
              ...prev,
              [item.id]: {
                ...(prev[item.id] || {}),
                status: 'error',
                progress: 0,
                error: err?.message || 'Falha de upload',
              },
            }));
          } finally {
            processed += 1;
            setProgress({ current: processed, total: files.length });
            writeUploadTask({
              status: 'running',
              title: 'Publicando pack',
              current: processed,
              total: files.length,
              progress: Math.round((processed / Math.max(1, files.length)) * 100),
              packKey: session.packKey,
              packUrl: session.webUrl,
              message: processed >= files.length ? 'Finalizando publicação...' : 'Processando próximo sticker...',
            });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, pendingFiles.length) }, () => runWorker()));

      if (failedCount > 0) {
        setStatus(`Upload concluído com ${failedCount} falha(s).`);
        setError(`Alguns stickers falharam. Clique em "🚀 Publicar Pack" novamente para reenviar apenas as falhas.`);
        setResult(session.created || result);
        setStep(3);
        writeUploadTask({
          status: 'error',
          title: 'Publicação parcial',
          current: Number(processed || 0),
          total: Number(files.length || 0),
          progress: Math.round((Number(processed || 0) / Math.max(1, Number(files.length || 1))) * 100),
          packKey: session.packKey,
          packUrl: session.webUrl,
          message: `${failedCount} sticker(s) falharam no upload.`,
        });
        return;
      }

      setStatus('Pack publicado com sucesso.');
      setResult(session.created || result);
      setStep(3);
      setActiveSession(null);
      clearCreatePackStorage();
    } catch (err) {
      setActiveSession(null);
      setError(err?.message || 'Falha ao publicar pack.');
      setStatus('');
      writeUploadTask({
        status: 'error',
        title: 'Falha na publicação',
        current: Number(progress.current || 0),
        total: Number(progress.total || files.length || 0),
        progress: Math.round((Number(progress.current || 0) / Math.max(1, Number(progress.total || files.length || 1))) * 100),
        packKey: null,
        packUrl: null,
        message: err?.message || 'Falha ao publicar pack.',
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onBeforeUnload = () => {
      if (!busy) return;
      writeUploadTask({
        status: 'paused',
        title: 'Publicação pausada',
        current: Number(progress.current || 0),
        total: Number(progress.total || files.length || 0),
        progress: Math.round((Number(progress.current || 0) / Math.max(1, Number(progress.total || files.length || 1))) * 100),
        packKey: activeSession?.packKey || result?.pack_key || null,
        packUrl: activeSession?.webUrl || result?.web_url || null,
        message: 'Você saiu da tela durante o envio.',
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy, progress.current, progress.total, files.length, result, activeSession]);

  const nextStep = () => {
    if (step === 1 && !canStep2) {
      if (!sanitizePackName(name, limits.pack_name_max_length).length) {
        setError('Defina um nome para avançar.');
        return;
      }
      setError('Informe seu número de celular com DDD para avançar.');
      return;
    }
    if (step === 2 && !canStep3) {
      setError('Adicione stickers para avançar.');
      return;
    }
    setError('');
    setStep((prev) => Math.min(3, prev + 1));
  };

  const prevStep = () => {
    setError('');
    setStep((prev) => Math.max(1, prev - 1));
  };

  const addTag = (rawValue) => {
    const normalized = normalizeTag(rawValue);
    if (!normalized) return;
    setTags((prev) => {
      if (prev.includes(normalized) || prev.length >= MAX_MANUAL_TAGS) return prev;
      return [...prev, normalized];
    });
    setTagInput('');
  };

  const removeTag = (value) => {
    const normalized = normalizeTag(value);
    setTags((prev) => prev.filter((entry) => entry !== normalized));
  };

  const onTagInputKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(tagInput);
      return;
    }
    if (event.key === 'Backspace' && !tagInput.trim()) {
      const last = tags[tags.length - 1];
      if (last) removeTag(last);
    }
  };

  const visibilityHelp =
    visibility === 'private'
      ? 'Privado: apenas você acessa este pack.'
      : visibility === 'unlisted'
        ? 'Não listado: acesso por link direto.'
        : 'Público: aparece no catálogo para descoberta.';

  return html`
    <div className="min-h-screen bg-base">
      <div className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 md:px-6 md:pb-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[.15em] text-accent">OmniZap Studio</p>
            <h1 className="font-display text-3xl font-extrabold md:text-4xl">Criar novo Pack</h1>
            <p className="mt-1 text-sm text-slate-400">Fluxo guiado para montar e publicar seu pack com visual de marketplace.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className="rounded-full border border-line bg-panel px-3 py-1">🧩 Até ${limits.stickers_per_pack} stickers</span>
            <span className="rounded-full border border-line bg-panel px-3 py-1">📦 Até ${limits.packs_per_owner} packs</span>
            <span className="rounded-full border border-line bg-panel px-3 py-1">✍ ${limits.pack_name_max_length} caracteres no nome</span>
          </div>
        </header>

        <div className="mb-5 grid gap-2 sm:grid-cols-3">
          ${STEPS.map((item) => html`<${StepPill} key=${item.id} step=${item} active=${step === item.id} done=${step > item.id} />`)}
        </div>
        <div className="mb-6">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-400">
            <span>Progresso</span>
            <span>${completionPercentage}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-900/80">
            <div className="h-full bg-accent transition-all duration-300" style=${{ width: `${completionPercentage}%` }}></div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(340px,1.1fr)_minmax(320px,.9fr)]">
          <section className="min-w-0 rounded-3xl border border-line bg-panel p-4 shadow-panel md:p-5">
            ${step === 1
              ? html`
                  <div className="space-y-4">
                    <${FloatingField}
                      label="Nome do pack"
                      value=${name}
                      maxLength=${limits.pack_name_max_length}
                      hint="Use um nome curto e fácil de encontrar."
                      onChange=${(e) => setName(sanitizePackName(e.target.value, limits.pack_name_max_length))}
                    />
                    <${FloatingField}
                      label="Descrição"
                      value=${description}
                      multiline=${true}
                      maxLength=${limits.description_max_length}
                      hint="Explique o tema do pack em uma frase curta"
                      onChange=${(e) => setDescription(clampText(e.target.value, limits.description_max_length))}
                    />
                    <${FloatingField}
                      label="Autor"
                      value=${publisher}
                      maxLength=${limits.publisher_max_length}
                      hint="Como seu nome será exibido no catálogo."
                      onChange=${(e) => setPublisher(clampText(e.target.value, limits.publisher_max_length))}
                    />
                    <${FloatingField}
                      label="Celular (WhatsApp)"
                      value=${accountId}
                      maxLength=${32}
                      hint="Obrigatório para vincular o pack ao criador. Ex: 5511999998888"
                      onChange=${(e) => setAccountId(String(e.target.value || '').replace(/[^\d+()\-\s]/g, '').slice(0, 32))}
                    />
                    ${accountId && !isValidPhone(accountId)
                      ? html`<p className="text-xs text-rose-300">Informe um número válido com DDD (10 a 15 dígitos).</p>`
                      : null}
                    <label className="block">
                      <span className="mb-2 inline-block text-xs font-semibold text-slate-300">Tags do pack</span>
                      <div className="rounded-2xl border border-line bg-panelSoft px-3 py-3">
                        <div className="mb-2 flex flex-wrap gap-2">
                          ${tags.map((tag) => html`
                            <button
                              key=${tag}
                              type="button"
                              onClick=${() => removeTag(tag)}
                              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent"
                              title="Remover tag"
                            >
                              #${tag}
                              <span aria-hidden="true">×</span>
                            </button>
                          `)}
                        </div>
                        <input
                          type="text"
                          value=${tagInput}
                          maxlength=${40}
                          onInput=${(e) => setTagInput(String(e.target.value || ''))}
                          onKeyDown=${onTagInputKeyDown}
                          onBlur=${() => addTag(tagInput)}
                          placeholder=${tags.length >= MAX_MANUAL_TAGS ? `Limite de ${MAX_MANUAL_TAGS} tags` : 'Digite e pressione Enter para adicionar'}
                          disabled=${tags.length >= MAX_MANUAL_TAGS}
                          className="h-10 w-full rounded-xl border border-line bg-panel px-3 text-sm outline-none transition focus:border-accent/60 disabled:opacity-60"
                        />
                        <p className="mt-2 text-[11px] text-slate-400">${tags.length}/${MAX_MANUAL_TAGS} tags selecionadas.</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          ${suggestedFromText.map((tag) => html`
                            <button
                              key=${tag}
                              type="button"
                              onClick=${() => addTag(tag)}
                              className="rounded-full border border-line bg-panel px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-accent/50 hover:text-accent"
                            >
                              + ${tag}
                            </button>
                          `)}
                        </div>
                      </div>
                    </label>
                    <label className="block">
                      <span className="mb-2 inline-block text-xs font-semibold text-slate-300">Visibilidade</span>
                      <select
                        value=${visibility}
                        onChange=${(e) => setVisibility(String(e.target.value || 'public'))}
                        className="h-12 w-full rounded-2xl border border-line bg-panelSoft px-4 text-sm outline-none focus:border-accent/60"
                      >
                        <option value="public">Público</option>
                        <option value="unlisted">Não listado</option>
                        <option value="private">Privado</option>
                      </select>
                      <p className="mt-2 text-[11px] text-slate-400">${visibilityHelp}</p>
                    </label>

                  </div>
                `
              : null}

            ${step === 2
              ? html`
                  <div className="space-y-4">
                    <div
                      onDragOver=${(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave=${() => setDragActive(false)}
                      onDrop=${onDropUpload}
                      className=${`rounded-3xl border-2 border-dashed p-6 text-center transition ${dragActive ? 'border-accent bg-accent/10' : 'border-line bg-panelSoft'}`}
                    >
                      <p className="text-base font-bold">Arraste e solte seus stickers aqui</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Imagens e vídeos até ${toBytesLabel(
                          limits.sticker_upload_source_max_bytes,
                        )} cada (conversão automática para .webp)
                      </p>
                      <input
                        id="webp-upload"
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange=${async (e) => {
                          await addIncomingFiles(e.target.files || []);
                          e.target.value = '';
                        }}
                      />
                      <label for="webp-upload" className="mt-4 inline-flex cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-extrabold text-slate-900">Selecionar stickers</label>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>${files.length}/${limits.stickers_per_pack} selecionados</span>
                      <span>Arraste para reordenar • toque para definir capa</span>
                    </div>

                    ${files.length
                      ? html`
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            ${files.map((item, index) => html`<${StickerThumb}
                              key=${item.id}
                              item=${item}
                              index=${index}
                              selectedCoverId=${coverId}
                              onSetCover=${setCoverId}
                              onRemove=${removeSticker}
                              onDragStart=${setDraggingStickerId}
                              onDropOn=${(targetId) => reorderStickers(draggingStickerId, targetId)}
                            />`)}
                          </div>
                        `
                      : html`<p className="rounded-2xl border border-line bg-panelSoft p-4 text-center text-sm text-slate-400">Nenhum sticker selecionado ainda.</p>`}
                  </div>
                `
              : null}

            ${step === 3
              ? html`
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-line bg-panelSoft p-4">
                      <h3 className="font-display text-lg font-bold">Revisão final</h3>
                      <ul className="mt-3 space-y-1 text-sm text-slate-300">
                        <li>Nome: <strong>${preview.name}</strong></li>
                        <li>Visibilidade: ${preview.visibility}</li>
                        <li>Stickers: ${files.length}</li>
                      </ul>
                    </div>

                    ${busy
                      ? html`
                          <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm">
                            <p className="font-semibold text-accent">${status || 'Processando...'}</p>
                            <p className="mt-1 text-slate-300">${progress.current}/${progress.total} concluídos</p>
                          </div>
                        `
                      : null}

                    <div className="rounded-2xl border border-line bg-panelSoft p-4">
                      ${(() => {
                        const total = Math.max(0, Number(progress.total || files.length || 0));
                        const done = Math.max(0, Math.min(total || 0, Number(progress.current || 0)));
                        const percent = Math.max(0, Math.min(100, Math.round((done / Math.max(1, total || 1)) * 100)));
                        const failed = failedUploadsCount;
                        const barTone = failed > 0 && !busy ? 'bg-rose-400' : result ? 'bg-emerald-400' : 'bg-accent';
                        return html`
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <p className="font-semibold text-slate-200">Progresso do envio</p>
                            <p className="text-slate-300">${done}/${total || files.length || 0} · ${percent}%</p>
                          </div>
                          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800">
                            <div className=${`h-full ${barTone} transition-all`} style=${{ width: `${percent}%` }}></div>
                          </div>
                          ${failed > 0
                            ? html`<p className="mt-2 text-xs text-rose-300">${failed} sticker(s) falharam. Você pode reenviar apenas as falhas.</p>`
                            : null}
                        `;
                      })()}
                    </div>

                    ${result
                      ? html`
                          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                            <p className="font-bold">Pack publicado com sucesso</p>
                            <p className="mt-1">${result.name} · ${result.pack_key}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a href=${result.web_url || `${webPath}/${result.pack_key}`} className="rounded-lg bg-emerald-300 px-3 py-1.5 text-xs font-bold text-slate-900">Abrir pack</a>
                              <a href=${webPath} className="rounded-lg border border-emerald-300/40 px-3 py-1.5 text-xs font-bold">Voltar ao marketplace</a>
                            </div>
                          </div>
                        `
                      : null}
                  </div>
                `
              : null}
          </section>

          <aside className="min-w-0 rounded-3xl border border-line bg-panel p-4 md:p-5">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-accent">Preview em tempo real</p>
            <article className="mt-3 min-w-0 overflow-hidden rounded-3xl border border-line bg-panelSoft">
              <img src=${preview.coverUrl} alt="Preview capa" className="aspect-square w-full object-cover bg-slate-900" />
              <div className="space-y-2 p-4">
                <p className="line-clamp-2 font-display text-lg font-bold">${preview.name}</p>
                <p className="line-clamp-2 text-sm text-slate-300">${preview.description || 'Descrição do pack aparecerá aqui.'}</p>
                <p className="text-xs text-slate-400">por ${preview.publisher}</p>
                <div className="flex flex-wrap items-center gap-1">
                  ${preview.tags.length
                    ? preview.tags.map((tag) => html`<span key=${tag} className="rounded-full border border-line px-2 py-0.5 text-[10px] text-slate-300">#${tag}</span>`)
                    : html`<span className="text-[10px] text-slate-500">Adicione tags para melhorar descoberta</span>`}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full border border-line px-2 py-1 text-slate-300">${preview.visibility}</span>
                  <span className="rounded-full border border-line px-2 py-1 text-slate-300">🧩 ${preview.stickerCount}</span>
                  <span className="rounded-full border border-line px-2 py-1 text-slate-300">❤️ ${preview.fakeLikes}</span>
                  <span className="rounded-full border border-line px-2 py-1 text-slate-300">⬇ ${preview.fakeOpens}</span>
                </div>
              </div>
            </article>
            <article className="mt-3 rounded-2xl border border-line bg-panelSoft p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[.08em] text-slate-400">Pack Score</p>
                <p className=${`text-sm font-bold ${quality.tone}`}>${quality.label} · ${quality.score}</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-900/80">
                <div className=${`h-full transition-all ${quality.bar}`} style=${{ width: `${quality.score}%` }}></div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Melhora com título claro, descrição, tags relevantes e stickers suficientes.</p>
            </article>
          </aside>
        </div>

        ${error ? html`<div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">${error}</div>` : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 p-3 backdrop-blur md:hidden">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-2">
          <button type="button" className="h-11 flex-1 rounded-xl border border-line bg-panelSoft text-sm font-bold" onClick=${prevStep} disabled=${step === 1 || busy}>Voltar</button>
          ${step < 3
            ? html`<button type="button" className="h-11 flex-[1.4] rounded-xl bg-accent text-sm font-extrabold text-slate-900 disabled:opacity-60" onClick=${nextStep} disabled=${busy}>Continuar</button>`
            : html`<button type="button" className="h-11 flex-[1.4] rounded-xl bg-accent2 text-sm font-extrabold text-slate-900 disabled:opacity-60" onClick=${publishPack} disabled=${!publishReady}>${publishLabel}</button>`}
        </div>
      </div>

      <div className="mt-6 hidden items-center justify-end gap-2 px-6 pb-6 md:flex">
        <button type="button" className="h-11 rounded-xl border border-line bg-panelSoft px-5 text-sm font-bold" onClick=${prevStep} disabled=${step === 1 || busy}>Voltar</button>
        ${step < 3
          ? html`<button type="button" className="h-11 rounded-xl bg-accent px-5 text-sm font-extrabold text-slate-900" onClick=${nextStep} disabled=${busy}>Próximo passo</button>`
          : html`<button type="button" className="h-11 rounded-xl bg-accent2 px-5 text-sm font-extrabold text-slate-900 disabled:opacity-60" onClick=${publishPack} disabled=${!publishReady}>${publishLabel}</button>`}
      </div>
    </div>
  `;
}

const root = document.getElementById('create-pack-react-root');
if (root) {
  createRoot(root).render(html`<${CreatePackApp} />`);
}
