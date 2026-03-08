export const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

export const formatPhone = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return 'Não informado';
  if (digits.length <= 4) return digits;
  if (digits.length <= 8) return `${digits.slice(0, -4)}-${digits.slice(-4)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, -4)}-${digits.slice(-4)}`;
  if (digits.length <= 13) return `+${digits.slice(0, 2)} ${digits.slice(2, -4)}-${digits.slice(-4)}`;
  return `+${digits.slice(0, 2)} ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
};

export const formatNumber = (value) =>
  new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(value || 0)));

export const formatDateTime = (value) => {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(ms));
};

export const buildLoginRedirectPath = (loginPath) => {
  const loginUrl = new URL(loginPath, window.location.origin);
  loginUrl.searchParams.set('next', '/user/');
  return `${loginUrl.pathname}${loginUrl.search}`;
};

export const buildWhatsAppUrl = (phoneDigits, text = '/menu') => {
  const digits = normalizeDigits(phoneDigits);
  const params = new URLSearchParams({
    text: String(text || '').trim() || '/menu',
    type: 'custom_url',
    app_absent: '0',
  });
  if (digits) params.set('phone', digits);
  return `https://api.whatsapp.com/send/?${params.toString()}`;
};

export const buildSupportWhatsAppUrl = (phoneDigits, text = 'Olá! Preciso de suporte no OmniZap.') => {
  const digits = normalizeDigits(phoneDigits);
  if (!digits) return '';
  const safeText = String(text || '').trim() || 'Olá! Preciso de suporte no OmniZap.';
  return `https://wa.me/${encodeURIComponent(digits)}?text=${encodeURIComponent(safeText)}`;
};

export const getSessionStatusLabel = (session) => {
  const authenticated = Boolean(session?.authenticated);
  return authenticated ? 'Sessão ativa' : 'Sessão não autenticada';
};

export const formatPackStatus = (status, visibility) => {
  const safeStatus =
    String(status || '')
      .trim()
      .toLowerCase() || 'desconhecido';
  const safeVisibility =
    String(visibility || '')
      .trim()
      .toLowerCase() || 'sem visibilidade';
  return `${safeStatus} · ${safeVisibility}`;
};
