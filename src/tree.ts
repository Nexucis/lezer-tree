export const DEFAULT_BUFFER_LENGTH = 1024
export const TYPE_TAGGED = 1

export interface ChangedRange {
  fromA: number
  toA: number
  fromB: number
  toB: number
}

export abstract class Subtree {
  abstract parent: Subtree | null

  abstract type: number
  abstract start: number
  abstract end: number

  get depth() {
    let d = 0
    for (let p = this.parent; p; p = p.parent) d++
    return d
  }

  get root(): Tree {
    let cx = this as Subtree
    while (cx.parent) cx = cx.parent
    return cx as Tree
  }

  abstract toString(tags?: TagMap<any>): string

  abstract iterate(from: number, to: number,
                   enter: (type: number, start: number, end: number) => any,
                   leave?: (type: number, start: number, end: number) => void): void

  abstract resolve(pos: number): Subtree

  abstract childBefore(pos: number): Subtree | null
  abstract childAfter(pos: number): Subtree | null
}

// Only the top-level object of this class is directly exposed to
// client code. Inspecting subtrees is done by allocating Subtree
// instances.
export class Tree extends Subtree {
  parent!: null

  constructor(readonly children: (Tree | TreeBuffer)[],
              readonly positions: number[],
              readonly type = 0,
              readonly length: number = positions.length ? positions[positions.length - 1] + children[positions.length - 1].length : 0) {
    super()
  }

  get start() { return 0 }

  toString(tags?: TagMap<any>): string {
    let name = (this.type & TYPE_TAGGED) == 0 ? null : tags ? tags.get(this.type) : this.type
    let children = this.children.map(c => c.toString(tags)).join()
    return !name ? children : name + (children.length ? "(" + children + ")" : "")
  }

  get end() { return this.length }

  partial(start: number, end: number, offset: number, children: (Tree | TreeBuffer)[], positions: number[]) {
    for (let i = 0; i < this.children.length; i++) {
      let from = this.positions[i]
      if (from > end) break
      let child = this.children[i], to = from + child.length
      if (to < start) continue
      if (start <= from && end >= to) {
        children.push(child)
        positions.push(from + offset)
      } else if (child instanceof Tree) {
        child.partial(start - from, end - from, offset + from, children, positions)
      }
    }
  }

  unchanged(changes: readonly ChangedRange[]) {
    if (changes.length == 0) return this
    let children: (Tree | TreeBuffer)[] = [], positions: number[] = []
    for (let i = 0, pos = 0, off = 0;; i++) {
      let next = i == changes.length ? null : changes[i]
      let nextPos = next ? next.fromA : this.length
      if (nextPos > pos) this.partial(pos, nextPos - 1 /* FIXME need a full (non-skipped) token here */, off, children, positions)
      if (!next) break
      pos = next.toA
      off += (next.toB - next.fromB) - (next.toA - next.fromA)
    }
    return new Tree(children, positions)
  }

  cut(at: number): Tree {
    if (at >= this.length) return this
    let children: (Tree | TreeBuffer)[] = [], positions: number[] = []
    for (let i = 0; i < this.children.length; i++) {
      let from = this.positions[i]
      if (from >= at) break
      let child = this.children[i], to = from + child.length
      children.push(to <= at ? child : child.cut(at - from))
      positions.push(from)
    }
    return new Tree(children, positions)
  }

  static empty = new Tree([], [])

  iterate(from: number, to: number,
          enter: (type: number, start: number, end: number) => any,
          leave?: (type: number, start: number, end: number) => void) {
    this.iterInner(from, to, 0, enter, leave)
  }

  // @internal
  iterInner(from: number, to: number, offset: number,
            enter: (type: number, start: number, end: number) => any,
            leave?: (type: number, start: number, end: number) => void) {
    if ((this.type & TYPE_TAGGED) != 0 &&
        enter(this.type, offset, offset + this.length) === false) return
    for (let i = 0; i < this.children.length; i++) {
      let child = this.children[i], start = this.positions[i] + offset, end = start + child.length
      if (start > to) break
      if (end < from) continue
      child.iterInner(from, to, start, enter, leave)
    }
    if (leave && (this.type & TYPE_TAGGED)) leave(this.type, offset, offset + this.length)
  }

  resolve(pos: number): Subtree {
    return this.resolveInner(pos, 0, this)
  }

  childBefore(pos: number): Subtree | null {
    return this.findChild(pos, -1, 0, this)
  }

  childAfter(pos: number): Subtree | null {
    return this.findChild(pos, 1, 0, this)
  }

  // @internal
  findChild(pos: number, side: number, start: number, parent: Subtree): Subtree | null {
    for (let i = 0; i < this.children.length; i++) {
      let childStart = this.positions[i] + start, select = -1
      if (childStart >= pos) {
        if (side < 0 && i > 0) select = i - 1
        else if (side > 0) select = i
        else break
      }
      if (select < 0 && (childStart + this.children[i].length > pos || side < 0 && i == this.children.length - 1))
        select = i
      if (select >= 0) {
        let child = this.children[select], childStart = this.positions[select] + start
        if (child.length == 0 && childStart == pos) continue
        if (child instanceof Tree) {
          if (child.type & TYPE_TAGGED) return new NodeSubtree(child, childStart, parent)
          return child.findChild(pos, side, childStart, parent)
        } else {
          let found = child.findIndex(pos, side, childStart, 0, child.buffer.length)
          if (found > -1) return new BufferSubtree(child, childStart, found, parent)
        }
      }
    }
    return null
  }

  // @internal
  resolveInner(pos: number, start: number, parent: Subtree): Subtree {
    let found = this.findChild(pos, 0, start, parent)
    return found ? found.resolve(pos) : parent
  }

  append(other: Tree) {
    if (other.positions[0] < this.length) throw new Error("Can't append overlapping trees")
    return new Tree(this.children.concat(other.children), this.positions.concat(other.positions))
  }

  static fromBuffer(buffer: readonly number[], maxBufferLength = DEFAULT_BUFFER_LENGTH): Tree {
    return buildTree(new FlatBufferCursor(buffer, buffer.length), maxBufferLength, true)
  }
}

Tree.prototype.parent = null

// Tree buffers contain type,start,end,childCount quads for each node.
// The nodes are built in postfix order (with parent nodes being
// written after child nodes), but converted to prefix order when
// wrapped in a TreeBuffer.
export class TreeBuffer {
  constructor(readonly buffer: Uint16Array) {}

  get nodeCount() { return this.buffer.length >> 2 }

  get length() { return this.buffer[this.buffer.length - 2] }

  toString(tags?: TagMap<any>) {
    let parts: string[] = []
    for (let index = 0; index < this.buffer.length;)
      index = this.childToString(index, parts, tags)
    return parts.join(",")
  }

  childToString(index: number, parts: string[], tags?: TagMap<any>): number {
    let type = this.buffer[index], count = this.buffer[index + 3]
    let result = String(tags ? tags.get(type)! : type)
    index += 4
    if (count) {
      let children: string[] = []
      for (let end = index + (count << 2); index < end;)
        index = this.childToString(index, children, tags)
      result += "(" + children.join(",") + ")"
    }
    parts.push(result)
    return index
  }

  cut(at: number) {
    let cutPoint = 0
    while (cutPoint < this.buffer.length && this.buffer[cutPoint + 1] < at) cutPoint += 4
    let newBuffer = new Uint16Array(cutPoint)
    for (let i = 0; i < cutPoint; i += 4) {
      newBuffer[i] = this.buffer[i]
      newBuffer[i + 1] = this.buffer[i + 1]
      newBuffer[i + 2] = Math.min(at, this.buffer[i + 2])
      newBuffer[i + 3] = Math.min(this.buffer[i + 3], ((cutPoint - i) >> 2) - 1)
    }
    return new TreeBuffer(newBuffer)
  }

  iterInner(from: number, to: number, offset: number,
            enter: (type: number, start: number, end: number) => any,
            leave?: (type: number, start: number, end: number) => void) {
    for (let index = 0; index < this.buffer.length;)
      index = this.iterChild(from, to, offset, index, enter, leave)
  }

  iterChild(from: number, to: number, offset: number, index: number,
            enter: (type: number, start: number, end: number) => any,
            leave?: (type: number, start: number, end: number) => void): number {
    let type = this.buffer[index++], start = this.buffer[index++] + offset,
        end = this.buffer[index++] + offset, count = this.buffer[index++]
    let endIndex = index + (count << 2)
    if (start > to) return this.buffer.length
    if (end >= from && enter(type, start, end) !== false) {
      while (index < endIndex) this.iterChild(from, to, offset, index, enter, leave)
      if (leave) leave(type, start, end)
    }
    return endIndex
  }

  findIndex(pos: number, side: number, start: number, from: number, to: number) {
    let lastI = -1
    for (let i = from, buf = this.buffer; i < to;) {
      let start1 = buf[i + 1] + start, end1 = buf[i + 2] + start
      let ignore = start1 == end1 && start1 == pos
      if (start1 >= pos) {
        if (side > 0 && !ignore) return i
        break
      }
      if (end1 > pos) return i
      if (!ignore) lastI = i
      i += 4 + (buf[i + 3] << 2)
    }
    return side < 0 ? lastI : -1
  }
}

class NodeSubtree extends Subtree {
  constructor(readonly node: Tree,
              readonly start: number,
              readonly parent: Subtree) {
    super()
  }

  get type() { return this.node.type }

  get end() { return this.start + this.node.length }

  resolve(pos: number): Subtree {
    if (pos <= this.start || pos >= this.end)
      return this.parent.resolve(pos)
    return this.node.resolveInner(pos, this.start, this)
  }

  childBefore(pos: number): Subtree | null {
    return this.node.findChild(pos, -1, this.start, this)
  }

  childAfter(pos: number): Subtree | null {
    return this.node.findChild(pos, 1, this.start, this)
  }

  toString(tags?: TagMap<any>) { return this.node.toString(tags) }

  iterate(from: number, to: number,
          enter: (type: number, start: number, end: number) => any,
          leave?: (type: number, start: number, end: number) => void) {
    return this.node.iterInner(from, to, this.start, enter, leave)
  }
}

class BufferSubtree extends Subtree {
  constructor(readonly buffer: TreeBuffer,
              readonly bufferStart: number,
              readonly index: number,
              readonly parent: Subtree) {
    super()
  }

  get type() { return this.buffer.buffer[this.index] }
  get start() { return this.buffer.buffer[this.index + 1] + this.bufferStart }
  get end() { return this.buffer.buffer[this.index + 2] + this.bufferStart }

  private get endIndex() { return this.index + 4 + (this.buffer.buffer[this.index + 3] << 2) }

  childBefore(pos: number): Subtree | null {
    let index = this.buffer.findIndex(pos, -1, this.bufferStart, this.index + 4, this.endIndex)
    return index < 0 ? null : new BufferSubtree(this.buffer, this.bufferStart, index, this)
  }

  childAfter(pos: number): Subtree | null {
    let index = this.buffer.findIndex(pos, 1, this.bufferStart, this.index + 4, this.endIndex)
    return index < 0 ? null : new BufferSubtree(this.buffer, this.bufferStart, index, this)
  }

  iterate(from: number, to: number,
          enter: (type: number, start: number, end: number) => any,
          leave?: (type: number, start: number, end: number) => void) {
    this.buffer.iterChild(from, to, this.bufferStart, this.index, enter, leave)
  }

  resolve(pos: number): Subtree {
    if (pos <= this.start || pos >= this.end) return this.parent.resolve(pos)
    let found = this.buffer.findIndex(pos, 0, this.bufferStart, this.index + 4, this.endIndex)
    return found < 0 ? this : new BufferSubtree(this.buffer, this.bufferStart, found, this).resolve(pos)
  }

  toString(tags?: TagMap<any>) {
    let result: string[] = []
    this.buffer.childToString(this.index, result, tags)
    return result.join("")
  }
}

export const REUSED_VALUE = -1

export interface BufferCursor {
  pos: number
  type: number
  start: number
  end: number
  size: number
  next(): void
  fork(): BufferCursor
}

class FlatBufferCursor implements BufferCursor {
  constructor(readonly buffer: readonly number[], public index: number) {}

  get type() { return this.buffer[this.index - 4] }
  get start() { return this.buffer[this.index - 3] }
  get end() { return this.buffer[this.index - 2] }
  get size() { return this.buffer[this.index - 1] }

  get pos() { return this.index }

  next() { this.index -= 4 }

  fork() { return new FlatBufferCursor(this.buffer, this.index) }
}

const BALANCE_BRANCH_FACTOR = 8

export function buildTree(cursor: BufferCursor, maxBufferLength: number, distribute: boolean, reused: Tree[] = []): Tree {
  function takeNode(parentStart: number, minPos: number, children: (Tree | TreeBuffer)[], positions: number[]) {
    let {type, start, end, size} = cursor, buffer!: {size: number, start: number} | null
    if (size == REUSED_VALUE) {
      cursor.next()
      children.push(reused[type])
      positions.push(start - parentStart)
    } else if (end - start <= maxBufferLength &&
               (buffer = findBufferSize(cursor.pos - minPos))) { // Small enough for a buffer, and no reused nodes inside
      let data = new Uint16Array(buffer.size)
      let endPos = cursor.pos - buffer.size, index = buffer.size
      while (cursor.pos > endPos)
        index = copyToBuffer(buffer.start, data, index)
      children.push(new TreeBuffer(data))
      positions.push(buffer.start - parentStart)
    } else { // Make it a node
      let endPos = cursor.pos - size
      cursor.next()
      let localChildren: (Tree | TreeBuffer)[] = [], localPositions: number[] = []
      while (cursor.pos > endPos)
        takeNode(start, endPos, localChildren, localPositions)
      localChildren.reverse(); localPositions.reverse()
      if (type & TYPE_TAGGED) {
        if (distribute && localChildren.length > BALANCE_BRANCH_FACTOR)
          ({children: localChildren, positions: localPositions} = balanceRange(0, localChildren, localPositions, 0, localChildren.length))
        children.push(new Tree(localChildren, localPositions, type, end - start))
      } else {
        children.push(balanceRange(type, localChildren, localPositions, 0, localChildren.length))
      }
      positions.push(start - parentStart)
    }
  }

  function balanceRange(type: number,
                        children: readonly (Tree | TreeBuffer)[], positions: readonly number[],
                        from: number, to: number): Tree {
    let start = positions[from], length = (positions[to - 1] + children[to - 1].length) - start
    if (from == to - 1 && start == 0) {
      let first = children[from]
      if (first instanceof Tree) return first
    }
    let localChildren = [], localPositions = []
    if (length <= maxBufferLength) {
      for (let i = from; i < to; i++) {
        let child = children[i]
        if (child instanceof Tree && child.type == type) {
          // Unwrap child with same type
          for (let j = 0; j < child.children.length; j++) {
            localChildren.push(child.children[j])
            localPositions.push(positions[i] + child.positions[j] - start)
          }
        } else {
          localChildren.push(child)
          localPositions.push(positions[i] - start)
        }
      }
    } else {
      let maxChild = Math.max(maxBufferLength, Math.ceil(length / BALANCE_BRANCH_FACTOR))
      for (let i = from; i < to;) {
        let groupFrom = i, groupStart = positions[i]
        i++
        for (; i < to; i++) {
          let nextEnd = positions[i] + children[i].length
          if (nextEnd - groupStart > maxChild) break
        }
        if (i == groupFrom + 1) {
          let only = children[groupFrom]
          if (only instanceof Tree && only.type == type) {
            // Already wrapped
            if (only.length > maxChild << 1) { // Too big, collapse
              for (let j = 0; j < only.children.length; j++) {
                localChildren.push(only.children[j])
                localPositions.push(only.positions[j] + groupStart - start)
              }
              continue
            }
          } else {
            // Wrap with our type to make reuse possible
            only = new Tree([only], [0], type, only.length)
          }
          localChildren.push(only)
        } else {
          localChildren.push(balanceRange(type, children, positions, groupFrom, i))
        }
        localPositions.push(groupStart - start)
      }
    }
    return new Tree(localChildren, localPositions, type, length)
  }

  function findBufferSize(maxSize: number) {
    // Scan through the buffer to find previous siblings that fit
    // together in a TreeBuffer, and don't contain any reused nodes
    // (which can't be stored in a buffer)
    let fork = cursor.fork()
    let size = 0, start = 0
    scan: for (let minPos = fork.pos - Math.min(maxSize, maxBufferLength); fork.pos > minPos;) {
      let nodeSize = fork.size, startPos = fork.pos - nodeSize
      if (nodeSize == REUSED_VALUE || startPos < minPos) break
      let nodeStart = fork.start
      fork.next()
      while (fork.pos > startPos) {
        if (fork.size == REUSED_VALUE) break scan
        fork.next()
      }
      start = nodeStart
      size += nodeSize
    }
    return size > 4 ? {size, start} : null
  }

  function copyToBuffer(bufferStart: number, buffer: Uint16Array, index: number): number {
    let {type, start, end, size} = cursor
    cursor.next()
    if (size > 4) {
      let firstChildIndex = index - (size - 4)
      while (index > firstChildIndex)
        index = copyToBuffer(bufferStart, buffer, index)
    }
    buffer[--index] = (size >> 2) - 1
    buffer[--index] = end - bufferStart
    buffer[--index] = start - bufferStart
    buffer[--index] = type
    return index
  }

  let children: (Tree | TreeBuffer)[] = [], positions: number[] = []
  while (cursor.pos > 0) takeNode(0, 0, children, positions)
  children.reverse(); positions.reverse()
  if (distribute && children.length > BALANCE_BRANCH_FACTOR)
    ({children, positions} = balanceRange(0, children, positions, 0, children.length))
  return new Tree(children, positions)
}

export class TagMap<T> {
  constructor(readonly content: readonly (T | null)[]) {}

  get(type: number): T | null { return type & TYPE_TAGGED ? this.content[type >> 1] : null }

  static empty = new TagMap<any>([])
}
