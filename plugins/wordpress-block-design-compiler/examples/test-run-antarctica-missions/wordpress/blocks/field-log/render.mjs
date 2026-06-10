export function render(attrs, helpers) {
  const { classList, escapeAttribute, richText, tag } = helpers;
  const items = Array.isArray(attrs.items) ? attrs.items : [];
  const html = items.map((item) => tag('article', {},
    '<time datetime="' + escapeAttribute(item.datetime || '') + '">' + richText(item.time || '') + '</time>' +
    tag('h3', {}, richText(item.title || '')) +
    tag('p', {}, richText(item.body || ''))
  )).join('');
  return tag('div', { class: classList('wp-block-wbdc-field-log', 'log-grid', attrs.className) }, html);
}
