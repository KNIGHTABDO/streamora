import { html } from '../../vendor/preact-htm.js';
import { BrowsePage, ShowArt } from './browse/shelf.js';

export default function Shows({ query }) {
  return html`<${BrowsePage} type="series" query=${query} header=${ShowArt} />`;
}
