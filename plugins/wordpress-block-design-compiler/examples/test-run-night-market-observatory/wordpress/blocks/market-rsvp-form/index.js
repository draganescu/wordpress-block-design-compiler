(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function fields(attributes) {
    return attributes.fields && attributes.fields.length ? attributes.fields : [];
  }

  registerBlockType('wbdc/market-rsvp-form', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const updateField = function (index, key, value) {
        const next = fields(attributes).slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ fields: next });
      };
      return el('form', useBlockProps({ className: 'rsvp-form', action: attributes.action || '#', method: attributes.method || 'post' }),
        fields(attributes).map(function (field, index) {
          return el('label', { key: field.name || index, className: field.wide ? 'wide-field' : undefined },
            el(RichText, { tagName: 'span', value: field.label || '', allowedFormats: [], onChange: function (value) { updateField(index, 'label', value); } }),
            el('input', { type: field.type || 'text', name: field.name || '', placeholder: field.placeholder || '', required: !!field.required, disabled: true })
          );
        }),
        el('button', { type: 'button', disabled: true },
          el(RichText, { tagName: 'span', value: attributes.buttonText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ buttonText: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('form', useBlockProps.save({ className: 'rsvp-form', action: attributes.action || '#', method: attributes.method || 'post' }),
        fields(attributes).map(function (field, index) {
          return el('label', { key: field.name || index, className: field.wide ? 'wide-field' : undefined },
            el(RichText.Content, { tagName: 'span', value: field.label || '' }),
            el('input', { type: field.type || 'text', name: field.name || '', placeholder: field.placeholder || '', required: !!field.required })
          );
        }),
        el('button', { type: 'submit' }, attributes.buttonText || '')
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
