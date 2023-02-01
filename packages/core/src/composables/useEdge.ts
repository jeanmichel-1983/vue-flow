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

  const edge = computed(() => findEdge<Data, CustomEvents>(edgeId.value)!)

  if (!edgeId.value || edgeId.value === '') {
    warn(`useEdge - No edge id provided and no injection could be found!`)
  } else if (!edge.value) {
    warn(`useEdge - Edge with id ${edgeId.value} not found!`)
  }

  return {
    id: edgeId,
    edge,
    edgeEl,
  }
}
