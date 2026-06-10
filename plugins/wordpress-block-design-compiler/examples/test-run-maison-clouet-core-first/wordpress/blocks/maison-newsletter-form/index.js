(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/maison-newsletter-form', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('form', useBlockProps({ action: attributes.action || '', method: attributes.method || 'post' }),
        el('label', null,
          el(RichText, { tagName: 'span', value: attributes.nameLabel || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ nameLabel: value }); } }),
          el('input', { type: 'text', name: 'name', placeholder: attributes.namePlaceholder || '', disabled: true })
        ),
        el('label', null,
          el(RichText, { tagName: 'span', value: attributes.emailLabel || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ emailLabel: value }); } }),
          el('input', { type: 'email', name: 'email', placeholder: attributes.emailPlaceholder || '', disabled: true })
        ),
        el('button', { type: 'submit', disabled: true },
          el(RichText, { tagName: 'span', value: attributes.buttonText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ buttonText: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('form', useBlockProps.save({ action: attributes.action || '', method: attributes.method || 'post' }),
        el('label', null,
          el(RichText.Content, { tagName: 'span', value: attributes.nameLabel || '' }),
          el('input', { type: 'text', name: 'name', placeholder: attributes.namePlaceholder || '' })
        ),
        el('label', null,
          el(RichText.Content, { tagName: 'span', value: attributes.emailLabel || '' }),
          el('input', { type: 'email', name: 'email', placeholder: attributes.emailPlaceholder || '' })
        ),
        el('button', { type: 'submit' },
          el(RichText.Content, { tagName: 'span', value: attributes.buttonText || '' })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
