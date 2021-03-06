## 0.12.3 (2020-11-02)

### New features

Make `NodePropSource` a function type.

## 0.12.2 (2020-10-28)

### Bug fixes

Fix a bug that made `SyntaxNode.prevSibling` fail in most cases when the node is part of a buffer.

## 0.12.1 (2020-10-26)

### Bug fixes

Fix issue where using `Tree.append` with an empty tree as argument would return a tree with a nonsensical `length` property.

## 0.12.0 (2020-10-23)

### Breaking changes

`Tree.iterate` no longer allows returning from inside the iteration (use cursors directly for that kind of use cases).

`Subtree` has been renamed to `SyntaxNode` and narrowed in scope a little.

The `top`, `skipped`, and `error` node props no longer exist.

### New features

The package now offers a `TreeCursor` abstraction, which can be used for both regular iteration and for custom traversal of a tree.

`SyntaxNode` instances have `nextSibling`/`prevSibling` getters that allow more direct navigation through the tree.

Node types now expose `isTop`, `isSkipped`, `isError`, and `isRepeated` properties that indicate special status.

Adds `NodeProp.group` to assign group names to node types.

Syntax nodes now have helper functions `getChild` and `getChildren` to retrieve direct child nodes by type or group.

`NodeType.match` (and thus `NodeProp.add`) now allows types to be targeted by group name.

Node types have a new `is` method for checking whether their name or one of their groups matches a given string.

## 0.11.1 (2020-09-26)

### Bug fixes

Fix lezer depencency versions

## 0.11.0 (2020-09-26)

### Breaking changes

Adjust to new output format of repeat rules.

## 0.10.0 (2020-08-07)

### Breaking changes

No longer list internal properties in the type definitions.

## 0.9.0 (2020-06-08)

### Breaking changes

Drop `NodeProp.delim` in favor of `NodeProp.openedBy`/`closedBy`.

## 0.8.4 (2020-04-01)

### Bug fixes

Make the package load as an ES module on node

## 0.8.3 (2020-02-28)

### New features

The package now provides an ES6 module.

## 0.8.2 (2020-02-26)

### Bug fixes

Fix a bug that caused `applyChanges` to include parts of the old tree that weren't safe to reuse.

## 0.8.1 (2020-02-14)

### Bug fixes

Fix bug that would cause tree balancing of deep trees to produce corrupt output.

## 0.8.0 (2020-02-03)

### New features

Bump version along with the rest of the lezer packages.

## 0.7.1 (2020-01-23)

### Bug fixes

In `applyChanges`, make sure the tree is collapsed all the way to the
nearest non-error node next to the change.

## 0.7.0 (2020-01-20)

### Bug fixes

Fix a bug that prevented balancing of repeat nodes when there were skipped nodes present between the repeated elements (which ruined the efficiency of incremental parses).

### New features

`TreeBuffer` objects now have an `iterate` function.

Buffers can optionally be tagged with an (unnamed) node type to allow reusing them in an incremental parse without wrapping them in a tree.

### Breaking changes

`Tree.build` now takes its arguments wrapped in an object. It also expects the buffer content to conform to from lezer 0.7.0's representation of repeated productions.

The `repeated` node prop was removed (the parser generator now encodes repetition in the type ids).

## 0.5.1 (2019-10-22)

### New features

`NodeProp.add` now also allows a selector object to be passed.

## 0.5.0 (2019-10-22)

### New features

Adds `NodeProp.top`, which flags a grammar's outer node type.

### Breaking changes

Drops the `NodeProp.lang` prop (superseded by `top`).

## 0.4.0 (2019-09-10)

### Bug fixes

Export `BufferCursor` again, which was accidentally removed from the exports in 0.3.0.

### Breaking changes

The `iterate` method now takes an object instead of separate parameters.

## 0.3.0 (2019-08-22)

### New features

Introduces node props.

Node types are now objects holding a name, id, and set of props.

### Breaking changes

Tags are gone again, nodes have plain string names.

## 0.2.0 (2019-08-02)

### Bug fixes

Fix incorrect node length calculation in `Tree.build`.

### New features

Tree nodes are now identified with tags.

New `Tag` data structure to represent node tags.

### Breaking changes

Drop support for grammar ids and node types.

## 0.1.1 (2019-07-09)

### Bug Fixes

Actually include the .d.ts file in the published package.

## 0.1.0 (2019-07-09)

### New Features

First documented release.
