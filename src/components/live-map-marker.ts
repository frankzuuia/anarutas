/** Google owns the marker container; React owns only the local SVG template. */
export function createLiveMapMarkerNode(truckIcon: SVGSVGElement | null) {
  const node = document.createElement("button");
  node.type = "button";
  const label = document.createElement("span");
  if (truckIcon) {
    const icon = truckIcon.cloneNode(true) as SVGSVGElement;
    icon.removeAttribute("class");
    node.append(icon);
    label.hidden = true;
  }
  node.append(label);
  return { node, label };
}
