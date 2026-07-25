import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import {
  configure,
  getQueriesForElement,
  prettyDOM,
  queries,
  type Queries,
} from "@testing-library/dom";

export * from "@testing-library/dom";
export { act };

const mountedContainers = new Set<Element | DocumentFragment>();

configure({
  eventWrapper: (callback) => {
    let result: unknown;
    act(() => {
      result = callback();
    });
    return result;
  },
});

interface RenderOptions<Q extends Queries = typeof queries> {
  container?: Element;
  baseElement?: Element | DocumentFragment;
  queries?: Q;
}

export function cleanup() {
  mountedContainers.forEach((container) => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    if (container instanceof Element && container.parentNode === document.body) {
      document.body.removeChild(container);
    }
  });
  mountedContainers.clear();
}

export function render<Q extends Queries = typeof queries>(
  ui: React.ReactElement,
  options: RenderOptions<Q> = {}
) {
  const baseElement = options.baseElement || document.body;
  const container =
    options.container || baseElement.appendChild(document.createElement("div"));
  const boundQueries = getQueriesForElement(
    baseElement,
    options.queries || queries
  );

  act(() => {
    ReactDOM.render(ui, container);
  });
  mountedContainers.add(container);

  return {
    container,
    baseElement,
    ...boundQueries,
    debug: (element: Element | DocumentFragment = baseElement) => {
      console.log(prettyDOM(element));
    },
    rerender: (nextUi: React.ReactElement) => {
      act(() => {
        ReactDOM.render(nextUi, container);
      });
    },
    unmount: () => {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      mountedContainers.delete(container);
    },
    asFragment: () => {
      const template = document.createElement("template");
      template.innerHTML =
        container instanceof Element ? container.innerHTML : "";
      return template.content;
    },
  };
}
