(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function signupForm(attributes, disabled, setAttributes) {
    const button = disabled && setAttributes
      ? el(RichText, { tagName: 'span', value: attributes.buttonText || '', allowedFormats: [], onChange: function (value) { setAttributes({ buttonText: value }); } })
      : el(RichText.Content, { tagName: 'span', value: attributes.buttonText || '' });

    return el('form', { action: '', method: 'post' },
      el('label', null,
        el('span', null, 'Name'),
        el('input', { type: 'text', name: 'name', placeholder: 'Your name', disabled: disabled || undefined })
      ),
      el('label', null,
        el('span', null, 'Email'),
        el('input', { type: 'email', name: 'email', placeholder: 'you@example.com', disabled: disabled || undefined })
      ),
      el('button', { type: 'submit', disabled: disabled || undefined }, button)
    );
  }

  registerBlockType('wbdc/maison-newsletter', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps({ id: attributes.sectionId || undefined, className: 'maison-newsletter', 'aria-labelledby': 'maison-newsletter-title' }),
        el('div', null,
          el(RichText, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el(RichText, { tagName: 'h2', id: 'maison-newsletter-title', value: attributes.heading || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ heading: value }); } }),
          el(RichText, { tagName: 'p', value: attributes.body || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ body: value }); } })
        ),
        signupForm(attributes, true, props.setAttributes)
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ id: attributes.sectionId || undefined, className: 'maison-newsletter', 'aria-labelledby': 'maison-newsletter-title' }),
        el('div', null,
          el(RichText.Content, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '' }),
          el(RichText.Content, { tagName: 'h2', id: 'maison-newsletter-title', value: attributes.heading || '' }),
          el(RichText.Content, { tagName: 'p', value: attributes.body || '' })
        ),
        signupForm(attributes, false)
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
