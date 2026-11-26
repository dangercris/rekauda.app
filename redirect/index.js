// Old URL (musical-navidad-1ba) kept alive as a permanent redirect to the class collections site.
const TARGET = "https://rekauda.app";

export default {
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/r/vestuario-musical" : url.pathname;
    return Response.redirect(`${TARGET}${path}${url.search}`, 301);
  },
};
