import { installYtDlpBinary, DEFAULT_YTDLP_BINARY_PATH } from './ytDlpInstaller.js';
import { fileURLToPath } from 'node:url';

async function instalarYtDlp() {
  console.log('📥 Iniciando instalação do yt-dlp...');
  console.log('⬇️ Baixando yt-dlp (versão mais recente)...');

  const caminhoBinario = await installYtDlpBinary({
    binaryPath: DEFAULT_YTDLP_BINARY_PATH,
  });

  console.log('✅ yt-dlp instalado com sucesso!');
  console.log(`📍 Caminho do binário: ${caminhoBinario}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  instalarYtDlp().catch((erro) => {
    console.error('❌ Erro ao instalar o yt-dlp:');
    console.error(erro.message);
  });
}

export { instalarYtDlp };
