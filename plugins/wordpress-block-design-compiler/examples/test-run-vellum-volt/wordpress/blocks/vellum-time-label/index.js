(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/vellum-time-label', {
    edit: function Edit(props) {
      return el(RichText, {
        tagName: 'time',
        value: props.attributes.label || '',
        dateTime: props.attributes.datetime || undefined,
        allowedFormats: [],
        onChange: function (value) { props.setAttributes({ label: value }); }
      });
    },
    save: function Save(props) {
      return el(RichText.Content, {
        tagName: 'time',
        value: props.attributes.label || '',
        dateTime: props.attributes.datetime || undefined
      });
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
