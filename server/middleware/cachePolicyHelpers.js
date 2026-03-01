export const isAssetPath = (pathname = '') =>
  pathname === '/stickers/assets/styles.css' || pathname === '/stickers/assets/catalog.js' || pathname.startsWith('/stickers/assets/');
