(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;

  registerBlockType('wbdc/field-log', {
    edit: function Edit(props) {
      return el('div', useBlockProps({ className: 'log-grid' }), (props.attributes.items || []).map(function (item, index) {
        return el('article', { key: index }, el('time', { dateTime: item.datetime || '' }, item.time || ''), el('h3', null, item.title || ''), el('p', null, item.body || ''));
      }));
    },
    save: function Save(props) {
      return el('div', useBlockProps.save({ className: 'log-grid' }), (props.attributes.items || []).map(function (item, index) {
        return el('article', { key: index }, el('time', { dateTime: item.datetime || '' }, item.time || ''), el('h3', null, item.title || ''), el('p', null, item.body || ''));
      }));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
