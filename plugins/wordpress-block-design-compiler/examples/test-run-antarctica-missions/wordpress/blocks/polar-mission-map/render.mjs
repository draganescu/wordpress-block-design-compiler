export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const nodes = Array.isArray(attrs.nodes) && attrs.nodes.length
    ? attrs.nodes
    : [
        { label: 'VOSTOK', className: 'node-one' },
        { label: 'ROSS', className: 'node-two' },
        { label: 'DOME C', className: 'node-three' },
      ];
  const nodeHtml = nodes
    .map((node) => tag('span', { class: classList('node', node.className) }, richText(node.label || '')))
    .join('');

  return tag('figure', { class: classList('wp-block-wbdc-polar-mission-map', 'polar-plate', attrs.className), 'aria-label': attrs.ariaLabel || 'Polar coordinate mission map' },
    tag('div', { class: 'map-grid', 'aria-hidden': 'true' },
      tag('span', { class: 'orbit orbit-a' }) +
      tag('span', { class: 'orbit orbit-b' }) +
      tag('span', { class: 'axis axis-x' }) +
      tag('span', { class: 'axis axis-y' }) +
      nodeHtml
    ) +
    tag('figcaption', {},
      tag('strong', {}, richText(attrs.title || 'Traverse corridor')) +
      tag('span', {}, richText(attrs.caption || 'sensor line / katabatic wind model / crevasse scan'))
    )
  );
}
