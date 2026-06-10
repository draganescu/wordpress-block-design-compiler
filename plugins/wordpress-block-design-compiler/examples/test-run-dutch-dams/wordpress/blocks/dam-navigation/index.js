(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  function links(attributes) {
    return attributes.links && attributes.links.length ? attributes.links : [];
  }

  registerBlockType('wbdc/dam-navigation', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const updateLink = function (index, key, value) {
        const next = links(attributes).slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ links: next });
      };
      return el('header', useBlockProps({ className: 'dam-nav', 'aria-label': attributes.ariaLabel || undefined }),
        el('a', { className: 'nav-mark', href: attributes.homeUrl || '#top', 'aria-label': attributes.homeLabel || undefined },
          el(RichText, { tagName: 'span', value: attributes.mark || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ mark: value }); } }),
          el(RichText, { tagName: 'strong', value: attributes.title || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ title: value }); } })
        ),
        el('nav', { className: 'nav-links', 'aria-label': attributes.navLabel || undefined },
          links(attributes).map(function (link, index) {
            return el('a', { key: index, href: link.url || '#' },
              el(RichText, { tagName: 'span', value: link.label || '', allowedFormats: [], onChange: function (value) { updateLink(index, 'label', value); } })
            );
          })
        ),
        el('a', { className: 'nav-action', href: attributes.actionUrl || '#archive' },
          el(RichText, { tagName: 'span', value: attributes.actionText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ actionText: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('header', useBlockProps.save({ className: 'dam-nav', 'aria-label': attributes.ariaLabel || undefined }),
        el('a', { className: 'nav-mark', href: attributes.homeUrl || '#top', 'aria-label': attributes.homeLabel || undefined },
          el(RichText.Content, { tagName: 'span', value: attributes.mark || '' }),
          el(RichText.Content, { tagName: 'strong', value: attributes.title || '' })
        ),
        el('nav', { className: 'nav-links', 'aria-label': attributes.navLabel || undefined },
          links(attributes).map(function (link, index) {
            return el('a', { key: index, href: link.url || '#' },
              el(RichText.Content, { tagName: 'span', value: link.label || '' })
            );
          })
        ),
        el('a', { className: 'nav-action', href: attributes.actionUrl || '#archive' },
          el(RichText.Content, { tagName: 'span', value: attributes.actionText || '' })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
