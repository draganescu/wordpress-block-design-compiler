(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/dam-timeline-rail', {
    edit: function Edit(props) {
      const events = props.attributes.events || [];
      const updateEvent = function (index, key, value) {
        const next = events.slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ events: next });
      };
      return el('section', useBlockProps({ className: 'dam-timeline-rail' }),
        events.map(function (event, index) {
          return el('article', { key: index, className: event.hot ? 'timeline-node is-hot' : 'timeline-node' },
            el(RichText, { tagName: 'time', value: event.year || '', allowedFormats: [], onChange: function (value) { updateEvent(index, 'year', value); } }),
            el(RichText, { tagName: 'h3', value: event.title || '', allowedFormats: ['core/italic'], onChange: function (value) { updateEvent(index, 'title', value); } }),
            el(RichText, { tagName: 'p', value: event.body || '', allowedFormats: ['core/bold', 'core/italic', 'core/link'], onChange: function (value) { updateEvent(index, 'body', value); } })
          );
        })
      );
    },
    save: function Save(props) {
      return el('section', useBlockProps.save({ className: 'dam-timeline-rail' }), (props.attributes.events || []).map(function (event, index) {
        return el('article', { key: index, className: event.hot ? 'timeline-node is-hot' : 'timeline-node' },
          el(RichText.Content, { tagName: 'time', value: event.year || '' }),
          el(RichText.Content, { tagName: 'h3', value: event.title || '' }),
          el(RichText.Content, { tagName: 'p', value: event.body || '' })
        );
      }));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
