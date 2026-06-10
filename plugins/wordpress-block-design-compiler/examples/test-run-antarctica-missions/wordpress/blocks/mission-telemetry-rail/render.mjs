export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const items = Array.isArray(attrs.items) && attrs.items.length
    ? attrs.items
    : [
        { index: '01', title: 'Dome C atmospheric drill', body: 'Balloon launches through diamond dust, collecting upper-air chemistry before the horizon disappears.', className: 'wide-card' },
        { index: '02', title: 'Ross Ice Shelf traverse', body: 'Ground radar marks hidden fracture fields under a convoy moving slower than walking pace.', className: '' },
        { index: '03', title: 'Vostok core relay', body: 'Two meters of ancient air are sealed and flown before thermal variance corrupts the sample.', className: 'accent-card' },
        { index: '04', title: 'Weddell acoustic night', body: 'Hydrophones listen under blue ice while the camp runs blackout discipline.', className: 'tall-card' },
      ];

  const itemHtml = items.map((item) => tag('article', { class: classList('mission-card', item.className) },
    tag('span', {}, richText(item.index || '')) +
    tag('h3', {}, richText(item.title || '')) +
    tag('p', {}, richText(item.body || ''))
  )).join('');

  return tag('div', {
    class: classList('wp-block-wbdc-mission-telemetry-rail', 'telemetry-rail', attrs.className),
    tabindex: '0',
    'aria-label': attrs.ariaLabel || 'Mission timeline',
  }, itemHtml);
}
