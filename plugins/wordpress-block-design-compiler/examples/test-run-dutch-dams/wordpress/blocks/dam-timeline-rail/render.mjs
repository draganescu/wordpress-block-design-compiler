export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const events = Array.isArray(attrs.events) ? attrs.events : [];
  const eventHtml = events.map((event) => tag('article', {
    class: classList('timeline-node', event.hot ? 'is-hot' : ''),
  }, [
    tag('time', {}, richText(event.year || '')),
    tag('h3', {}, richText(event.title || '')),
    tag('p', {}, richText(event.body || '')),
  ].join(''))).join('');
  return tag('section', { class: classList('wp-block-wbdc-dam-timeline-rail', 'dam-timeline-rail', attrs.className), 'aria-label': attrs.ariaLabel || '' }, eventHtml);
}
