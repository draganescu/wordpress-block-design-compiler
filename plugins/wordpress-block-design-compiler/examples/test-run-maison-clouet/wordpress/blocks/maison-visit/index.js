(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/maison-visit', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps({ id: attributes.sectionId || undefined, className: 'maison-visit', 'aria-labelledby': 'maison-visit-title' }),
        el('figure', { className: 'maison-storefront', 'aria-label': 'Maison Clouet storefront illustration' },
          el(RichText, { tagName: 'span', value: attributes.photoLabel || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ photoLabel: value }); } })
        ),
        el('div', { className: 'maison-visit-copy' },
          el(RichText, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ eyebrow: value }); } }),
          el(RichText, { tagName: 'h2', id: 'maison-visit-title', value: attributes.heading || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ heading: value }); } }),
          el(RichText, { tagName: 'p', value: attributes.body || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ body: value }); } }),
          el('dl', null,
            el('div', null, el('dt', null, 'Address'), el(RichText, { tagName: 'dd', value: attributes.address || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ address: value }); } })),
            el('div', null, el('dt', null, 'Hours'), el(RichText, { tagName: 'dd', value: attributes.hours || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ hours: value }); } }))
          )
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('section', useBlockProps.save({ id: attributes.sectionId || undefined, className: 'maison-visit', 'aria-labelledby': 'maison-visit-title' }),
        el('figure', { className: 'maison-storefront', 'aria-label': 'Maison Clouet storefront illustration' },
          el(RichText.Content, { tagName: 'span', value: attributes.photoLabel || '' })
        ),
        el('div', { className: 'maison-visit-copy' },
          el(RichText.Content, { tagName: 'p', className: 'eyebrow', value: attributes.eyebrow || '' }),
          el(RichText.Content, { tagName: 'h2', id: 'maison-visit-title', value: attributes.heading || '' }),
          el(RichText.Content, { tagName: 'p', value: attributes.body || '' }),
          el('dl', null,
            el('div', null, el('dt', null, 'Address'), el(RichText.Content, { tagName: 'dd', value: attributes.address || '' })),
            el('div', null, el('dt', null, 'Hours'), el(RichText.Content, { tagName: 'dd', value: attributes.hours || '' }))
          )
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
