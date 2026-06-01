/** Подписка на изменения каталога + обновление при возврате на вкладку */
function bindProductLiveRefresh(sb, reloadFn) {
  if (!sb || typeof reloadFn !== 'function') return;

  const safeReload = () => {
    try {
      reloadFn();
    } catch (e) {
      console.warn('live-catalog reload', e);
    }
  };

  try {
    sb.channel('talaria-products-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, safeReload)
      .subscribe();
  } catch (e) {
    console.warn('Supabase realtime:', e);
  }

  setInterval(safeReload, 120000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') safeReload();
  });
}
