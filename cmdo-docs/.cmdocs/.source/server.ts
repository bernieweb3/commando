// @ts-nocheck
import * as __fd_glob_28 from "../content/docs/documentation/reference/env-vars.mdx?collection=docs"
import * as __fd_glob_27 from "../content/docs/documentation/reference/cli.mdx?collection=docs"
import * as __fd_glob_26 from "../content/docs/documentation/guides/troubleshooting.mdx?collection=docs"
import * as __fd_glob_25 from "../content/docs/documentation/guides/safety.mdx?collection=docs"
import * as __fd_glob_24 from "../content/docs/documentation/guides/llm-setup.mdx?collection=docs"
import * as __fd_glob_23 from "../content/docs/documentation/guides/installation.mdx?collection=docs"
import * as __fd_glob_22 from "../content/docs/documentation/guides/architecture.mdx?collection=docs"
import * as __fd_glob_21 from "../content/docs/documentation/examples/walrus-sites.mdx?collection=docs"
import * as __fd_glob_20 from "../content/docs/documentation/examples/sui-flows.mdx?collection=docs"
import * as __fd_glob_19 from "../content/docs/reference/env-vars.mdx?collection=docs"
import * as __fd_glob_18 from "../content/docs/reference/cli.mdx?collection=docs"
import * as __fd_glob_17 from "../content/docs/guides/writing-content.mdx?collection=docs"
import * as __fd_glob_16 from "../content/docs/guides/validate.mdx?collection=docs"
import * as __fd_glob_15 from "../content/docs/guides/troubleshooting.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/guides/safety.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/guides/llm-setup.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/guides/installation.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/guides/deploy.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/guides/components.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/guides/architecture.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/examples/walrus-sites.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/examples/sui-flows.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/documentation/quickstart.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/documentation/index.mdx?collection=docs"
import { default as __fd_glob_4 } from "../content/docs/documentation/reference/meta.json?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/documentation/guides/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/documentation/examples/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/documentation/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "documentation/meta.json": __fd_glob_1, "documentation/examples/meta.json": __fd_glob_2, "documentation/guides/meta.json": __fd_glob_3, "documentation/reference/meta.json": __fd_glob_4, }, {"documentation/index.mdx": __fd_glob_5, "documentation/quickstart.mdx": __fd_glob_6, "examples/sui-flows.mdx": __fd_glob_7, "examples/walrus-sites.mdx": __fd_glob_8, "guides/architecture.mdx": __fd_glob_9, "guides/components.mdx": __fd_glob_10, "guides/deploy.mdx": __fd_glob_11, "guides/installation.mdx": __fd_glob_12, "guides/llm-setup.mdx": __fd_glob_13, "guides/safety.mdx": __fd_glob_14, "guides/troubleshooting.mdx": __fd_glob_15, "guides/validate.mdx": __fd_glob_16, "guides/writing-content.mdx": __fd_glob_17, "reference/cli.mdx": __fd_glob_18, "reference/env-vars.mdx": __fd_glob_19, "documentation/examples/sui-flows.mdx": __fd_glob_20, "documentation/examples/walrus-sites.mdx": __fd_glob_21, "documentation/guides/architecture.mdx": __fd_glob_22, "documentation/guides/installation.mdx": __fd_glob_23, "documentation/guides/llm-setup.mdx": __fd_glob_24, "documentation/guides/safety.mdx": __fd_glob_25, "documentation/guides/troubleshooting.mdx": __fd_glob_26, "documentation/reference/cli.mdx": __fd_glob_27, "documentation/reference/env-vars.mdx": __fd_glob_28, });