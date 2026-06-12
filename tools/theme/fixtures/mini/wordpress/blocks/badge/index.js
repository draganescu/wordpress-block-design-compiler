(function (blocks, blockEditor, components, element) {
    const el = element.createElement;
    blocks.registerBlockType("mini/badge", {
        apiVersion: 3,
        edit: function (props) {
            return el('span', blockEditor.useBlockProps({ className: 'badge' }), props.attributes.label || '');
        },
        save: function (props) {
            return el('span', blockEditor.useBlockProps.save({ className: 'badge' }), props.attributes.label || '');
        }
    });
})(window.wp.blocks, window.wp.blockEditor, window.wp.components, window.wp.element);
