/** Font files bundled as binary data (wrangler.jsonc "rules": Data). */
declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
