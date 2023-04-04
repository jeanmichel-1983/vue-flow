import { zoomIdentity } from 'd3-zoom'
import type {
  Actions,
  ComputedGetters,
  CoordinateExtent,
  EdgeChange,
  EdgeRemoveChange,
  EdgeSelectionChange,
  Elements,
  FlowExportObject,
  GraphEdge,
  GraphNode,
  Node,
  NodeChange,
  NodeDimensionChange,
  NodePositionChange,
  NodeRemoveChange,
  NodeSelectionChange,
  Rect,
  State,
} from '~/types'

export function useActions(state: State, getters: ComputedGetters): Actions {
  let fitViewOnInitDone = false

  const viewportHelper = $(useViewport(state, getters))

  until(() => viewportHelper.initialized)
    .toBe(true)
    .then(() => {})

  const nodeIds = $computed(() => state.nodes.map((n) => n.id))
  const edgeIds = $computed(() => state.edges.map((e) => e.id))

  const updateNodeInternals: Actions['updateNodeInternals'] = (ids) => {
    const updateIds = ids ?? nodeIds ?? []

    state.hooks.updateNodeInternals.trigger(updateIds)
  }

  const findNode: Actions['findNode'] = (id) => {
    if (state.nodes && !nodeIds.length) return state.nodes.find((node) => node.id === id)

    return state.nodes[nodeIds.indexOf(id)]
  }

  const findEdge: Actions['findEdge'] = (id) => {
    if (state.edges && !edgeIds.length) return state.edges.find((edge) => edge.id === id)

    return state.edges[edgeIds.indexOf(id)]
  }

  const updateNodePositions: Actions['updateNodePositions'] = (dragItems, changed, dragging) => {
    const changes: NodePositionChange[] = []

    dragItems.forEach((node) => {
      const change: Partial<NodePositionChange> = {
        id: node.id,
        type: 'position',
        dragging,
        from: node.from,
      }

      if (changed) {
        change.position = node.position

        if (node.parentNode) {
          const parentNode = findNode(node.parentNode)

          change.position = {
            x: change.position.x - (parentNode?.computedPosition?.x ?? 0),
            y: change.position.y - (parentNode?.computedPosition?.y ?? 0),
          }
        }
      }

      changes.push(change as NodePositionChange)
    })

    if (changes?.length) {
      state.hooks.nodesChange.trigger(changes)
    }
  }

  const updateNodeDimensions: Actions['updateNodeDimensions'] = (updates) => {
    if (!state.vueFlowRef) return

    const viewportNode = state.vueFlowRef.querySelector('.vue-flow__transformationpane') as HTMLElement

    if (!viewportNode) return

    // todo: remove this feature again, it's not working properly
    let zoom: number
    if (state.__experimentalFeatures?.nestedFlow) {
      let viewportNodes: HTMLElement[] = [viewportNode]
      let parentNode = viewportNode
      let isNested

      while (!isNested && parentNode) {
        parentNode = parentNode.parentElement!
        isNested = parentNode?.classList.contains('vue-flow__transformationpane')

        if (isNested) {
          viewportNodes = [parentNode, ...viewportNodes]
        }
      }

      viewportNodes.forEach((vp) => {
        const style = window.getComputedStyle(vp)
        const { m22 } = new window.DOMMatrixReadOnly(style.transform)
        if (!zoom) zoom = m22
        else zoom *= m22
      })
    } else {
      const style = window.getComputedStyle(viewportNode)
      const { m22 } = new window.DOMMatrixReadOnly(style.transform)
      zoom = m22
    }

    const changes: NodeDimensionChange[] = updates.reduce<NodeDimensionChange[]>((res, update) => {
      const node = findNode(update.id)

      if (node) {
        const dimensions = getDimensions(update.nodeElement)

        const doUpdate = !!(
          dimensions.width &&
          dimensions.height &&
          (node.dimensions.width !== dimensions.width || node.dimensions.height !== dimensions.height || update.forceUpdate)
        )

        if (doUpdate) {
          node.handleBounds.source = getHandleBounds('.source', update.nodeElement, zoom)
          node.handleBounds.target = getHandleBounds('.target', update.nodeElement, zoom)
          node.dimensions = dimensions
          node.initialized = true

          res.push({
            id: node.id,
            type: 'dimensions',
            dimensions,
          })
        }
      }

      return res
    }, [])

    if (state.fitViewOnInit && !fitViewOnInitDone) {
      until(() => viewportHelper.initialized)
        .toBe(true)
        .then(() => {
          viewportHelper.fitView()
        })

      fitViewOnInitDone = true
    }

    if (changes.length) state.hooks.nodesChange.trigger(changes)
  }

  const nodeSelectionHandler = (nodes: GraphNode[], selected: boolean) => {
    const nodeIds = nodes.map((n) => n.id)

    let changedNodes: NodeChange[]
    let changedEdges: EdgeChange[] = []
    if (state.multiSelectionActive) changedNodes = nodeIds.map((nodeId) => createSelectionChange(nodeId, selected))
    else {
      const selectionChanges = getSelectionChanges([...state.nodes, ...state.edges], nodeIds)
      changedNodes = selectionChanges.changedNodes
      changedEdges = selectionChanges.changedEdges
    }

    if (changedNodes.length) state.hooks.nodesChange.trigger(changedNodes)
    if (changedEdges.length) state.hooks.edgesChange.trigger(changedEdges)
  }

  const edgeSelectionHandler = (edges: GraphEdge[], selected: boolean) => {
    const edgeIds = edges.map((n) => n.id)

    let changedNodes: NodeChange[] = []
    let changedEdges: EdgeChange[]
    if (state.multiSelectionActive) changedEdges = edgeIds.map((edgeId) => createSelectionChange(edgeId, selected))
    else {
      const selectionChanges = getSelectionChanges([...state.nodes, ...state.edges], edgeIds)
      changedNodes = selectionChanges.changedNodes
      changedEdges = selectionChanges.changedEdges
    }

    if (changedNodes.length) state.hooks.nodesChange.trigger(changedNodes)
    if (changedEdges.length) state.hooks.edgesChange.trigger(changedEdges)
  }

  const elementSelectionHandler = (elements: Elements, selected: boolean) => {
    const nodes = elements.filter(isGraphNode)
    const edges = elements.filter(isGraphEdge)

    const nodeIds = nodes.map((n) => n.id)
    const edgeIds = edges.map((e) => e.id)

    let { changedNodes, changedEdges } = getSelectionChanges([...state.nodes, ...state.edges], [...nodeIds, ...edgeIds])

    if (state.multiSelectionActive) changedNodes = nodeIds.map((nodeId) => createSelectionChange(nodeId, selected))
    if (state.multiSelectionActive) changedEdges = edgeIds.map((edgeId) => createSelectionChange(edgeId, selected))

    if (changedNodes.length) state.hooks.nodesChange.trigger(changedNodes)
    if (changedEdges.length) state.hooks.edgesChange.trigger(changedEdges)
  }

  const addSelectedNodes: Actions['addSelectedNodes'] = (nodes) => {
    nodeSelectionHandler(nodes, true)
  }

  const addSelectedEdges: Actions['addSelectedEdges'] = (edges) => {
    edgeSelectionHandler(edges, true)
  }

  const addSelectedElements: Actions['addSelectedElements'] = (elements) => {
    elementSelectionHandler(elements, true)
  }

  const removeSelectedNodes: Actions['removeSelectedNodes'] = (nodes) => {
    if (!nodes.length) return nodeSelectionHandler(nodes, false)

    const nodeIds = nodes.map((n) => n.id)

    const changedNodes = nodeIds.map((nodeId) => createSelectionChange(nodeId, false))

    if (changedNodes.length) state.hooks.nodesChange.trigger(changedNodes)
  }

  const removeSelectedEdges: Actions['removeSelectedEdges'] = (edges) => {
    if (!edges.length) return edgeSelectionHandler(edges, false)

    const edgeIds = edges.map((e) => e.id)

    const changedEdges = edgeIds.map((edgeId) => createSelectionChange(edgeId, false))

    if (changedEdges.length) state.hooks.edgesChange.trigger(changedEdges)
  }

  const removeSelectedElements: Actions['removeSelectedElements'] = (elements) => {
    if (!elements || !elements.length) return elementSelectionHandler([], false)

    const { changedNodes, changedEdges } = elements.reduce(
      (acc, curr) => {
        const selectionChange = createSelectionChange(curr.id, false)
        if (isGraphNode(curr)) acc.changedNodes.push(selectionChange)
        else acc.changedEdges.push(selectionChange)

        return acc
      },
      { changedNodes: [] as NodeSelectionChange[], changedEdges: [] as EdgeSelectionChange[] },
    )

    if (changedNodes.length) state.hooks.nodesChange.trigger(changedNodes)
    if (changedEdges.length) state.hooks.edgesChange.trigger(changedEdges)
  }

  const setMinZoom: Actions['setMinZoom'] = (minZoom) => {
    state.d3Zoom?.scaleExtent([minZoom, state.maxZoom])
    state.minZoom = minZoom
  }

  const setMaxZoom: Actions['setMaxZoom'] = (maxZoom) => {
    state.d3Zoom?.scaleExtent([state.minZoom, maxZoom])
    state.maxZoom = maxZoom
  }

  const setTranslateExtent: Actions['setTranslateExtent'] = (translateExtent) => {
    state.d3Zoom?.translateExtent(translateExtent)
    state.translateExtent = translateExtent
  }

  const setNodeExtent: Actions['setNodeExtent'] = async (nodeExtent) => {
    state.nodeExtent = nodeExtent

    const nodeIds = getters.getNodes.value.filter((n) => n.initialized).map((n) => n.id)
    updateNodeInternals(nodeIds)
  }

  const setInteractive: Actions['setInteractive'] = (isInteractive) => {
    state.nodesDraggable = isInteractive
    state.nodesConnectable = isInteractive
    state.elementsSelectable = isInteractive
  }

  const setNodes: Actions['setNodes'] = (nodes) => {
    const nextNodes = nodes instanceof Function ? nodes(state.nodes) : nodes

    if (!state.initialized && !nextNodes.length) return

    state.nodes = createGraphNodes(nextNodes, state.nodes, findNode, state.hooks.error.trigger)
  }

  const setEdges: Actions['setEdges'] = (edges) => {
    const nextEdges = edges instanceof Function ? edges(state.edges) : edges

    if (!state.initialized && !nextEdges.length) return

    const validEdges = state.isValidConnection
      ? nextEdges.filter((edge) =>
          state.isValidConnection!(edge, {
            edges: state.edges,
            sourceNode: findNode(edge.source)!,
            targetNode: findNode(edge.target)!,
          }),
        )
      : nextEdges

    state.edges = validEdges.reduce<GraphEdge[]>((res, edge) => {
      const sourceNode = findNode(edge.source)!
      const targetNode = findNode(edge.target)!

      const missingSource = !sourceNode || typeof sourceNode === 'undefined'
      const missingTarget = !targetNode || typeof targetNode === 'undefined'

      if (missingSource && missingTarget) {
        state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_SOURCE_TARGET_MISSING, edge.id, edge.source, edge.target))
      } else {
        if (missingSource) {
          state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_SOURCE_MISSING, edge.id, edge.source))
        }

        if (missingTarget) {
          state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_TARGET_MISSING, edge.id, edge.target))
        }
      }

      if (missingSource || missingTarget) {
        return res
      }

      const storedEdge = getters.getEdge.value(edge.id)

      res.push({
        ...parseEdge(edge, Object.assign({}, storedEdge, state.defaultEdgeOptions)),
        sourceNode,
        targetNode,
      })

      return res
    }, [])
  }

  const setElements: Actions['setElements'] = (elements) => {
    const nextElements = elements instanceof Function ? elements([...state.nodes, ...state.edges]) : elements

    if (!state.initialized && !nextElements.length) return

    setNodes(nextElements.filter(isNode))
    setEdges(nextElements.filter(isEdge))
  }

  const addNodes: Actions['addNodes'] = (nodes) => {
    const nextNodes = nodes instanceof Function ? nodes(state.nodes) : nodes

    const graphNodes = createGraphNodes(nextNodes, state.nodes, findNode, state.hooks.error.trigger)

    const changes = graphNodes.map(createAdditionChange)

    if (changes.length) state.hooks.nodesChange.trigger(changes)
  }

  const addEdges: Actions['addEdges'] = (params) => {
    const nextEdges = params instanceof Function ? params(state.edges) : params

    const validEdges = state.isValidConnection
      ? nextEdges.filter((edge) =>
          state.isValidConnection!(edge, {
            edges: state.edges,
            sourceNode: findNode(edge.source)!,
            targetNode: findNode(edge.target)!,
          }),
        )
      : nextEdges

    const changes = validEdges.reduce((acc, param) => {
      const edge = addEdgeToStore(
        {
          ...param,
          ...state.defaultEdgeOptions,
        },
        state.edges,
        state.hooks.error.trigger,
      )

      if (edge) {
        const sourceNode = findNode(edge.source)!
        const targetNode = findNode(edge.target)!

        const missingSource = !sourceNode || typeof sourceNode === 'undefined'
        const missingTarget = !targetNode || typeof targetNode === 'undefined'

        if (missingSource && missingTarget) {
          state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_SOURCE_TARGET_MISSING, edge.id, edge.source, edge.target))
        } else {
          if (missingSource) {
            state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_SOURCE_MISSING, edge.id, edge.source))
          }

          if (missingTarget) {
            state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_TARGET_MISSING, edge.id, edge.target))
          }
        }

        if (missingSource || missingTarget) {
          return acc
        }

        acc.push(
          createAdditionChange<GraphEdge>({
            ...edge,
            sourceNode,
            targetNode,
          }),
        )
      }

      return acc
    }, [] as EdgeChange[])

    if (changes.length) state.hooks.edgesChange.trigger(changes)
  }

  const removeNodes: Actions['removeNodes'] = (nodes, removeConnectedEdges = true) => {
    const curr = nodes instanceof Function ? nodes(state.nodes) : nodes
    const nodeChanges: NodeRemoveChange[] = []
    const edgeChanges: EdgeRemoveChange[] = []

    curr.forEach((item) => {
      const currNode = typeof item === 'string' ? findNode(item)! : item

      if (isDef(currNode.deletable) && !currNode.deletable) return

      nodeChanges.push(createRemoveChange(currNode.id))

      if (removeConnectedEdges) {
        const connections = getConnectedEdges([currNode], state.edges).filter((edge) => {
          if (isDef(edge.deletable)) return edge.deletable
          return true
        })

        edgeChanges.push(...connections.map((connection) => createRemoveChange(connection.id)))
      }
    })

    if (edgeChanges.length) {
      state.hooks.edgesChange.trigger(edgeChanges)
    }

    if (nodeChanges.length) {
      state.hooks.nodesChange.trigger(nodeChanges)
    }
  }

  const removeEdges: Actions['removeEdges'] = (edges) => {
    const curr = edges instanceof Function ? edges(state.edges) : edges
    const changes: EdgeRemoveChange[] = []

    curr.forEach((item) => {
      const currEdge = typeof item === 'string' ? findEdge(item)! : item

      if (isDef(currEdge.deletable) && !currEdge.deletable) return

      changes.push(createRemoveChange(typeof item === 'string' ? item : item.id))
    })

    state.hooks.edgesChange.trigger(changes)
  }

  const updateEdge: Actions['updateEdge'] = (oldEdge, newConnection, shouldReplaceId = true) =>
    updateEdgeAction(oldEdge, newConnection, state.edges, findEdge, shouldReplaceId, state.hooks.error.trigger)

  const applyNodeChanges: Actions['applyNodeChanges'] = (changes) => applyChanges(changes, state.nodes)

  const applyEdgeChanges: Actions['applyEdgeChanges'] = (changes) => applyChanges(changes, state.edges)

  const startConnection: Actions['startConnection'] = (startHandle, position, event, isClick = false) => {
    if (isClick) {
      state.connectionClickStartHandle = startHandle
    } else {
      state.connectionStartHandle = startHandle
    }

    state.connectionEndHandle = null
    state.connectionStatus = null

    if (position) state.connectionPosition = position
  }

  const updateConnection: Actions['updateConnection'] = (position, result = null, status = null) => {
    if (state.connectionStartHandle) {
      state.connectionPosition = position
      state.connectionEndHandle = result
      state.connectionStatus = status
    }
  }

  const endConnection: Actions['endConnection'] = (event, isClick) => {
    state.connectionPosition = { x: NaN, y: NaN }
    state.connectionStatus = null

    if (isClick) {
      state.connectionClickStartHandle = null
    } else {
      state.connectionStartHandle = null
    }
  }

  const getNodeRect = (
    nodeOrRect: (Partial<Node> & { id: Node['id'] }) | Rect,
  ): [Rect | null, Node | null | undefined, boolean] => {
    const isRectObj = isRect(nodeOrRect)
    const node = isRectObj ? null : findNode(nodeOrRect.id)

    if (!isRectObj && !node) {
      return [null, null, isRectObj]
    }

    const nodeRect = isRectObj ? nodeOrRect : nodeToRect(node!)

    return [nodeRect, node, isRectObj]
  }

  // todo: rename to `findIntersectingNodes`
  const getIntersectingNodes: Actions['getIntersectingNodes'] = (nodeOrRect, partially = true, nodes) => {
    const [nodeRect, node, isRect] = getNodeRect(nodeOrRect)

    if (!nodeRect) return []

    return (nodes || state.nodes).filter((n) => {
      if (!isRect && (n.id === node!.id || !n.computedPosition)) return false

      const currNodeRect = nodeToRect(n)
      const overlappingArea = getOverlappingArea(currNodeRect, nodeRect)
      const partiallyVisible = partially && overlappingArea > 0

      return partiallyVisible || overlappingArea >= Number(nodeOrRect.width) * Number(nodeOrRect.height)
    })
  }

  const isNodeIntersecting: Actions['isNodeIntersecting'] = (nodeOrRect, area, partially = true) => {
    const [nodeRect] = getNodeRect(nodeOrRect)

    if (!nodeRect) return false

    const overlappingArea = getOverlappingArea(nodeRect, area)
    const partiallyVisible = partially && overlappingArea > 0

    return partiallyVisible || overlappingArea >= Number(nodeOrRect.width) * Number(nodeOrRect.height)
  }

  const panBy: Actions['panBy'] = (delta) => {
    const { viewport, dimensions, d3Zoom, d3Selection, translateExtent } = state

    if (!d3Zoom || !d3Selection || (!delta.x && !delta.y)) return

    const nextTransform = zoomIdentity.translate(viewport.x + delta.x, viewport.y + delta.y).scale(viewport.zoom)

    const extent: CoordinateExtent = [
      [0, 0],
      [dimensions.width, dimensions.height],
    ]

    const constrainedTransform = d3Zoom.constrain()(nextTransform, extent, translateExtent)

    d3Zoom.transform(d3Selection, constrainedTransform)
  }

  const setState: Actions['setState'] = (options) => {
    const opts = options instanceof Function ? options(state) : options
    const skip: (keyof typeof opts)[] = [
      'modelValue',
      'nodes',
      'edges',
      'maxZoom',
      'minZoom',
      'translateExtent',
      'nodeExtent',
      'hooks',
    ]

    const elements = opts.modelValue || opts.nodes || opts.edges ? ([] as Elements) : undefined

    if (elements) {
      if (opts.modelValue) {
        elements.push(...opts.modelValue)
      }

      if (opts.nodes) {
        elements.push(...opts.nodes)
      }

      if (opts.edges) {
        elements.push(...opts.edges)
      }

      setElements(elements)
    }

    const setSkippedOptions = () => {
      if (typeof opts.maxZoom !== 'undefined') setMaxZoom(opts.maxZoom)
      if (typeof opts.minZoom !== 'undefined') setMinZoom(opts.minZoom)
      if (typeof opts.translateExtent !== 'undefined') setTranslateExtent(opts.translateExtent)
      if (typeof opts.nodeExtent !== 'undefined') setNodeExtent(opts.nodeExtent)
    }

    Object.keys(opts).forEach((o) => {
      const option = opts[o as keyof typeof opts]
      if (!skip.includes(o as keyof typeof opts) && isDef(option)) (<any>state)[o] = option
    })

    if (!state.d3Zoom) {
      until(() => state.d3Zoom)
        .not.toBeUndefined()
        .then(setSkippedOptions)
    } else {
      setSkippedOptions()
    }

    if (!state.initialized) state.initialized = true
  }

  const toObject: Actions['toObject'] = () => {
    // we have to stringify/parse so objects containing refs (like nodes and edges) can potentially be saved in a storage
    return JSON.parse(
      JSON.stringify({
        nodes: state.nodes.map((n) => {
          // omit internal properties when exporting
          const {
            computedPosition: _,
            handleBounds: __,
            selected: ___,
            dimensions: ____,
            isParent: _____,
            resizing: ______,
            dragging: _______,
            initialized: ________,
            ...rest
          } = n

          return rest
        }),
        edges: state.edges.map((e) => {
          // omit internal properties when exporting
          const { selected: _, sourceNode: __, targetNode: ___, ...rest } = e

          return rest
        }),
        position: [state.viewport.x, state.viewport.y],
        zoom: state.viewport.zoom,
      } as FlowExportObject),
    )
  }

  return {
    updateNodePositions,
    updateNodeDimensions,
    setElements,
    setNodes,
    setEdges,
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    findNode,
    findEdge,
    updateEdge,
    applyEdgeChanges,
    applyNodeChanges,
    addSelectedElements,
    addSelectedNodes,
    addSelectedEdges,
    setMinZoom,
    setMaxZoom,
    setTranslateExtent,
    setNodeExtent,
    removeSelectedElements,
    removeSelectedNodes,
    removeSelectedEdges,
    startConnection,
    updateConnection,
    endConnection,
    setInteractive,
    setState,
    getIntersectingNodes,
    isNodeIntersecting,
    panBy,
    fitView: async (params = { padding: 0.1 }) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.fitView(params)
    },
    zoomIn: async (options) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.zoomIn(options)
    },
    zoomOut: async (options) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.zoomOut(options)
    },
    zoomTo: async (zoomLevel, options) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.zoomTo(zoomLevel, options)
    },
    setTransform: async (transform, options) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.setTransform(transform, options)
    },
    getTransform: () => viewportHelper.getTransform(),
    setCenter: async (x, y, options) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.setCenter(x, y, options)
    },
    fitBounds: async (bounds, options) => {
      await until(() => viewportHelper.initialized).toBe(true)
      viewportHelper.fitBounds(bounds, options)
    },
    project: (position) => viewportHelper.project(position),
    toObject,
    updateNodeInternals,
    $reset: () => {
      state.edges = []
      state.nodes = []

      setState(useState())
    },
    $destroy: () => {},
  }
}
