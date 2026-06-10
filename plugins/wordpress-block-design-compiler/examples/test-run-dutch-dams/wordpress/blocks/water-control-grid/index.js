(function (blocks, blockEditor, element) {
  const el = element.createElement;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;

  registerBlockType('wbdc/water-control-grid', {
    edit: function Edit(props) {
      const tiles = props.attributes.tiles || [];
      const updateTile = function (index, key, value) {
        const next = tiles.slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        props.setAttributes({ tiles: next });
      };
      return el('section', useBlockProps({ className: 'water-control-grid' }),
        tiles.map(function (tile, index) {
          return el('article', { key: index, className: ['control-tile', tile.variant ? 'control-tile--' + tile.variant : ''].filter(Boolean).join(' ') },
            el(RichText, { tagName: 'span', value: tile.number || '', allowedFormats: [], onChange: function (value) { updateTile(index, 'number', value); } }),
            el(RichText, { tagName: 'h3', value: tile.title || '', allowedFormats: ['core/italic'], onChange: function (value) { updateTile(index, 'title', value); } }),
            el(RichText, { tagName: 'p', value: tile.body || '', allowedFormats: ['core/bold', 'core/italic', 'core/link'], onChange: function (value) { updateTile(index, 'body', value); } }),
            el(RichText, { tagName: 'strong', value: tile.metric || '', allowedFormats: [], onChange: function (value) { updateTile(index, 'metric', value); } })
          );
        })
      );
    },
    save: function Save(props) {
      const blockProps = useBlockProps.save({ className: 'water-control-grid' });
      return el('section', blockProps, (props.attributes.tiles || []).map(function (tile, index) {
        return el('article', { key: index, className: ['control-tile', tile.variant ? 'control-tile--' + tile.variant : ''].filter(Boolean).join(' ') },
          el(RichText.Content, { tagName: 'span', value: tile.number || '' }),
          el(RichText.Content, { tagName: 'h3', value: tile.title || '' }),
          el(RichText.Content, { tagName: 'p', value: tile.body || '' }),
          el(RichText.Content, { tagName: 'strong', value: tile.metric || '' })
        );
      }));
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.element);
