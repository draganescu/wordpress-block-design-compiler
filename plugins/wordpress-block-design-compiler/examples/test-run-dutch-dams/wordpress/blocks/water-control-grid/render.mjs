export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const tiles = Array.isArray(attrs.tiles) ? attrs.tiles : [];
  const tileHtml = tiles.map((tile) => tag('article', {
    class: classList('control-tile', tile.variant ? `control-tile--${tile.variant}` : ''),
  }, [
    tag('span', {}, richText(tile.number || '')),
    tag('h3', {}, richText(tile.title || '')),
    tag('p', {}, richText(tile.body || '')),
    tag('strong', {}, richText(tile.metric || '')),
  ].join(''))).join('');
  return tag('section', { class: classList('wp-block-wbdc-water-control-grid', 'water-control-grid', attrs.className), 'aria-label': attrs.ariaLabel || '' }, tileHtml);
}
