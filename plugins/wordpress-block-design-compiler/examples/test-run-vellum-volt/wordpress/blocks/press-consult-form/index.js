(function (blocks, blockEditor, components, element) {
  const el = element.createElement;
  const Fragment = element.Fragment;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;
  const InspectorControls = blockEditor.InspectorControls;
  const PanelBody = components.PanelBody;
  const TextControl = components.TextControl;
  const ToggleControl = components.ToggleControl;

  registerBlockType("wbdc/press-consult-form", {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const setAttributes = props.setAttributes;
      const blockProps = useBlockProps({ className: "press-consult-form" });
      const fields = attributes.fields && attributes.fields.length ? attributes.fields : [{ label: 'Email address', type: 'email', name: 'email', placeholder: '', required: false }];
      const updateField = function (index, key, value) {
        const next = fields.slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        setAttributes({ fields: next });
      };

      return el(Fragment, null,
        el(InspectorControls, null, el(PanelBody, { title: 'Settings' }, el(TextControl, { label: "Action", value: attributes.action || '', onChange: function (value) { setAttributes({ action: value }); } }),
            el(TextControl, { label: "Method", value: attributes.method || '', onChange: function (value) { setAttributes({ method: value }); } }))),
        el('section', blockProps,
          el('form', { className: "press-consult-form__form booking-form" },
            fields.map(function (field, index) {
              return el('label', { key: field.name || index, className: field.type === 'textarea' ? 'wide-field' : undefined },
                el(RichText, {
                  tagName: 'span',
                  className: "press-consult-form__field-label",
                  value: field.label || '',
                  placeholder: 'Field label',
                  allowedFormats: ['core/bold', 'core/italic'],
                  onChange: function (value) { updateField(index, 'label', value); }
                }),
                field.type === 'textarea'
                  ? el('textarea', { name: field.name || '', placeholder: field.placeholder || '', required: !!field.required, disabled: true })
                  : el('input', { type: field.type || 'text', name: field.name || '', placeholder: field.placeholder || '', required: !!field.required, disabled: true })
              );
            }),
            el('button', { type: 'button', disabled: true },
              el(RichText, {
                tagName: 'span',
                value: attributes.buttonText || 'Submit',
                placeholder: 'Button text',
                allowedFormats: ['core/bold', 'core/italic'],
                onChange: function (value) { setAttributes({ buttonText: value }); }
              })
            )
          )
        )
      );
    },

    save: function Save(props) {
      const attributes = props.attributes;
      const blockProps = useBlockProps.save({ className: "press-consult-form" });
      return el('section', blockProps,
          el('form', { className: "press-consult-form__form booking-form", action: attributes.action || '#', method: attributes.method || 'post' },
            (attributes.fields || []).map(function (field, index) {
              const name = field.name || String(field.label || 'field-' + index).toLowerCase().replace(/[^a-z0-9]+/g, '-');
              return el('label', { key: name, className: field.type === 'textarea' ? 'wide-field' : undefined },
                el('span', null, field.label || name),
                field.type === 'textarea'
                  ? el('textarea', { name: name, placeholder: field.placeholder || '', required: !!field.required })
                  : el('input', { type: field.type || 'text', name: name, placeholder: field.placeholder || '', required: !!field.required })
              );
            }),
            el('button', { type: 'submit' }, attributes.buttonText || 'Submit')
          )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.components, window.wp.element);
