import type { Project } from "./types";

export function isExampleProject(project: Project) {
  return (
    project.settings?.is_example === true || project.id.startsWith("example_")
  );
}
/** Allocate a separate editing identity before any async jobs capture its ID. */
export function exampleDraft(source: Project): Project {
  const draft = structuredClone(source);
  draft.id = "project_" + crypto.randomUUID().replaceAll("-", "");
  draft.settings = { ...draft.settings, source_example_id: source.id };
  delete draft.settings.is_example;
  return draft;
}
export function savedExampleDraft(draft: Project): Project {
  return {
    ...draft,
    name: (draft.name.slice(0, 188) + " · 我的作品").slice(0, 200),
  };
}
