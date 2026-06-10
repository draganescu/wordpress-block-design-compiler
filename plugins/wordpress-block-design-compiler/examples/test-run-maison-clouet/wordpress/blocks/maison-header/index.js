(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function links(attributes) {
    return attributes.links && attributes.links.length ? attributes.links : [];
  }

  registerBlockType('wbdc/maison-header', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const updateLink = function (index, key, value) {
        const next = links(attributes).slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ links: next });
      };

      return el('header', useBlockProps({ id: attributes.sectionId || undefined, className: 'maison-header' }),
        el('a', { className: 'maison-brand', href: attributes.homeUrl || '#top', 'aria-label': 'Maison Clouet home' },
          el(RichText, { tagName: 'span', value: attributes.brand || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ brand: value }); } }),
          el(RichText, { tagName: 'small', value: attributes.tagline || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ tagline: value }); } })
        ),
        el('nav', { className: 'maison-nav', 'aria-label': 'Primary' },
          links(attributes).map(function (link, index) {
            return el('a', { key: index, href: link.url || '#' },
              el(RichText, { tagName: 'span', value: link.label || '', allowedFormats: [], onChange: function (value) { updateLink(index, 'label', value); } })
            );
          })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('header', useBlockProps.save({ id: attributes.sectionId || undefined, className: 'maison-header' }),
        el('a', { className: 'maison-brand', href: attributes.homeUrl || '#top', 'aria-label': 'Maison Clouet home' },
          el(RichText.Content, { tagName: 'span', value: attributes.brand || '' }),
          el(RichText.Content, { tagName: 'small', value: attributes.tagline || '' })
        ),
        el('nav', { className: 'maison-nav', 'aria-label': 'Primary' },
          links(attributes).map(function (link, index) {
            return el('a', { key: index, href: link.url || '#' },
              el(RichText.Content, { tagName: 'span', value: link.label || '' })
            );
          })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
