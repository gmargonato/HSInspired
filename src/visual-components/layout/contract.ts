import type { Container } from 'pixi.js'

const LABEL_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/

/** Returns true when a Pixi label follows the `zone.element` inspector format. */
export function isLayoutLabel(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && LABEL_PATTERN.test(value)
}

/** Assigns a validated inspector label and returns the target for fluent setup. */
export function setLayoutLabel<T extends Container>(target: T, label: string): T {
  if (!isLayoutLabel(label)) {
    throw new Error(`Layout labels must use zone.element format: ${label}`)
  }
  target.label = label
  return target
}

/** Finds visual children that are missing a label or use a legacy delimiter. */
export function findLayoutLabelViolations(root: Container): readonly string[] {
  const violations: string[] = []
  const visit = (container: Container, path: string): void => {
    for (const [index, child] of container.children.entries()) {
      const childPath = `${path}/${index}`
      if (!child.label || !isLayoutLabel(child.label)) violations.push(childPath)
      if (child.children.length > 0) visit(child, childPath)
    }
  }
  visit(root, 'root')
  return violations
}
