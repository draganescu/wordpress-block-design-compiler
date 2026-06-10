export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const items = Array.isArray(attrs.items) && attrs.items.length
    ? attrs.items
    : [
        { label: 'Temp', value: '-48°C' },
        { label: 'Wind', value: '61 knots' },
        { label: 'Payload', value: '12 cores' },
      ];
  const html = items.map((item) => tag('div', {},
    tag('dt', {}, richText(item.label || '')) +
    tag('dd', {}, richText(item.value || ''))
  )).join('');
  return tag('dl', { class: classList('wp-block-wbdc-mission-metrics', 'mission-metrics', attrs.className) }, html);
}
