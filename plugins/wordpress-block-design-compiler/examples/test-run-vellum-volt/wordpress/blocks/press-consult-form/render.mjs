export function render(attrs, helpers) {
  const { classList, escapeAttribute, richText, tag } = helpers;
  const fields = Array.isArray(attrs.fields) ? attrs.fields : [];
  const fieldHtml = fields.map((field) => {
    const name = field.name || String(field.label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const control = field.type === 'textarea'
      ? '<textarea name="' + escapeAttribute(name) + '" placeholder="' + escapeAttribute(field.placeholder || '') + '" rows="' + escapeAttribute(field.rows || 5) + '"' + (field.required ? ' required' : '') + '></textarea>'
      : '<input name="' + escapeAttribute(name) + '" type="' + escapeAttribute(field.type || 'text') + '" placeholder="' + escapeAttribute(field.placeholder || '') + '"' + (field.required ? ' required' : '') + '>';
    return tag('label', { class: field.type === 'textarea' ? 'wide-field' : '' },
      tag('span', {}, richText(field.label || name)) + control
    );
  }).join('');
  return tag('section', { class: classList('wp-block-wbdc-press-consult-form', 'press-consult-form', attrs.className) },
    tag('form', { class: classList('press-consult-form__form', 'booking-form'), action: attrs.action || '/contact', method: attrs.method || 'post' },
      fieldHtml + tag('button', { type: 'submit' }, richText(attrs.buttonText || 'Send the brief'))
    )
  );
}
