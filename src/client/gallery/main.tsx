import { ConfigProvider } from "../lib/config/ConfigProvider";
import { mount } from "../mount";
import { Gallery } from "./Gallery";
import { SAMPLE_CONFIG } from "./samples";

// The style guide runs without a Worker: it shows a fictional tenant instead of asking /api/config.
mount(
  <ConfigProvider initial={SAMPLE_CONFIG}>
    <Gallery />
  </ConfigProvider>,
);
