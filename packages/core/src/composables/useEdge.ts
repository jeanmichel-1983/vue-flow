import type { MaybeRef } from '@vueuse/core'
import type { CustomEvent, ElementData } from '~/types'

/**
 * Access an edge
 *
 * If no edge id is provided, the edge id is injected from context
 *
 * Meaning if you do not provide an id, this composable has to be called in a child of your custom edge component, or it will throw
 */
export default function useEdge<Data = ElementData, CustomEvents extends Record<string, CustomEvent> = any>(
  id?: MaybeRef<string>,
) {
  const { findEdge } = useVueFlow()

  const edgeRef = inject(EdgeRef, null)

  const edgeIdInjection = inject(EdgeId, '')

  const edgeId = computed(() => unref(id) ?? edgeIdInjection)

  const edgeEl = computed(() => unref(edgeRef) ?? document.querySelector(`[data-id="${edgeId.value}"]`))

  const edge = computed(() => findEdge<Data, CustomEvents>(edgeId.value))

  watch(
    [() => edge.value?.id, edgeId],
    ([nextEdge, nextId]) => {
      if (!nextId || nextId === '') {
        throw new VueFlowError('useEdge', `No node id provided and no injection could be found!`)
      } else if (!nextEdge) {
        throw new VueFlowError('useEdge', `Node with id ${edgeId.value} not found!`)
      }
    },
    { immediate: true },
  )

  return {
    id: edgeId,
    edge,
    edgeEl,
  }
}
