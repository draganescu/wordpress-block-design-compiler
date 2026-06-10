(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/mission-station-strip', {
    edit: function Edit(props) {
      const attributes = props.attributes;
      return el('header', useBlockProps({ className: 'station-strip', 'aria-label': attributes.ariaLabel || undefined }),
        el('a', { className: 'station-id', href: attributes.homeUrl || '#top', 'aria-label': attributes.homeLabel || undefined },
          el(RichText, { tagName: 'span', value: attributes.code || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ code: value }); } }),
          el(RichText, { tagName: 'strong', value: attributes.title || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ title: value }); } })
        ),
        el(RichText, { tagName: 'p', value: attributes.status || '', allowedFormats: ['core/italic'], onChange: function (value) { props.setAttributes({ status: value }); } }),
        el('a', { className: 'strip-action', href: attributes.actionUrl || '#signal' },
          el(RichText, { tagName: 'span', value: attributes.actionText || '', allowedFormats: [], onChange: function (value) { props.setAttributes({ actionText: value }); } })
        )
      );
    },
    save: function Save(props) {
      const attributes = props.attributes;
      return el('header', useBlockProps.save({ className: 'station-strip', 'aria-label': attributes.ariaLabel || undefined }),
        el('a', { className: 'station-id', href: attributes.homeUrl || '#top', 'aria-label': attributes.homeLabel || undefined },
          el(RichText.Content, { tagName: 'span', value: attributes.code || '' }),
          el(RichText.Content, { tagName: 'strong', value: attributes.title || '' })
        ),
        el(RichText.Content, { tagName: 'p', value: attributes.status || '' }),
        el('a', { className: 'strip-action', href: attributes.actionUrl || '#signal' },
          el(RichText.Content, { tagName: 'span', value: attributes.actionText || '' })
        )
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
