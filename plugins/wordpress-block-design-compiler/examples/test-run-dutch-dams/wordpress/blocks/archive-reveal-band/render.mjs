export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const plates = Array.isArray(attrs.plates) ? attrs.plates : [];
  const plateHtml = plates.map((plate) => tag('article', {
    class: classList('archive-plate', plate.className),
  }, [
    tag('span', {}, richText(plate.label || '')),
    tag('h3', {}, richText(plate.title || '')),
    tag('p', {}, richText(plate.body || '')),
  ].join(''))).join('');
  return tag('section', { class: classList('wp-block-wbdc-archive-reveal-band', 'archive-reveal-band', attrs.className), 'aria-label': attrs.ariaLabel || '' }, plateHtml);
}
