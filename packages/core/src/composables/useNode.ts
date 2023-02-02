import type { MaybeRef } from '@vueuse/core'
import type { CustomEvent, ElementData } from '~/types'

/**
 * Access a node, it's parent (if one exists) and connected edges
 *
 * If no node id is provided, the node id is injected from context
 *
 * Meaning if you do not provide an id, this composable has to be called in a child of your custom node component, or it will throw
 */
export default function useNode<Data = ElementData, CustomEvents extends Record<string, CustomEvent> = any>(
  id?: MaybeRef<string>,
) {
  const { findNode, getEdges } = useVueFlow()

  const nodeIdInjection = inject(NodeId, '')

  const nodeId = computed(() => unref(id) ?? nodeIdInjection)

  const nodeRef = inject(NodeRef, null)

  const nodeEl = computed(() => unref(nodeRef) ?? document.querySelector(`[data-id="${nodeId.value}"]`))

  const node = computed(() => findNode<Data, CustomEvents>(nodeId.value)!)

  const parentNode = computed(() => (node.value?.parentNode ? findNode(node.value.parentNode) : undefined))

  const connectedEdges = computed(() => (node.value ? getConnectedEdges([node.value], getEdges.value) : []))

  watch(
    [() => node.value?.id, nodeId],
    ([nextNode, nextId]) => {
      if (!nextId || nextId === '') {
        throw new VueFlowError('useNode', `No node id provided and no injection could be found!`)
      }

      nextTick(() => {
        if (!nextNode) {
          throw new VueFlowError('useNode', `Node with id ${nodeId.value} not found!`)
        }
      })
    },
    { immediate: true, flush: 'post' },
  )

  return {
    id: nodeId,
    nodeEl,
    node,
    parentNode,
    connectedEdges,
  }
}
