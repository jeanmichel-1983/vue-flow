<script lang="ts" setup>
const { emits, viewport, getSelectedNodes, noPanClassName, disableKeyboardA11y, userSelectionActive } = $(useVueFlow())

const updatePositions = useUpdateNodePositions()

const el = ref()

const dragging = useDrag({
  el,
  onStart(event, node, nodes) {
    emits.selectionDragStart({ event, node, nodes })
  },
  onDrag(event, node, nodes) {
    emits.selectionDrag({ event, node, nodes })
  },
  onStop(event, node, nodes) {
    emits.selectionDragStop({ event, node, nodes })
  },
})

onMounted(() => {
  if (!disableKeyboardA11y) {
    el.value?.focus({ preventScroll: true })
  }
})

const selectedNodesBBox = $computed(() => getRectOfNodes(getSelectedNodes))

const innerStyle = computed(() => ({
  width: `${selectedNodesBBox.width}px`,
  height: `${selectedNodesBBox.height}px`,
  top: `${selectedNodesBBox.y}px`,
  left: `${selectedNodesBBox.x}px`,
}))

function onContextMenu(event: MouseEvent) {
  emits.selectionContextMenu({ event, nodes: getSelectedNodes })
}

function onKeyDown(event: KeyboardEvent) {
  if (disableKeyboardA11y) return

  if (arrowKeyDiffs[event.key]) {
    updatePositions(
      {
        x: arrowKeyDiffs[event.key].x,
        y: arrowKeyDiffs[event.key].y,
      },
      event.shiftKey,
    )
  }
}
</script>

<script lang="ts">
export default {
  name: 'NodesSelection',
  compatConfig: { MODE: 3 },
}
</script>

<template>
  <div
    v-if="!userSelectionActive && selectedNodesBBox.width && selectedNodesBBox.height"
    class="vue-flow__nodesselection vue-flow__container"
    :class="noPanClassName"
    :style="{ transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }"
  >
    <div
      ref="el"
      :class="{ dragging }"
      class="vue-flow__nodesselection-rect"
      :style="innerStyle"
      :tabIndex="disableKeyboardA11y ? undefined : -1"
      @contextmenu="onContextMenu"
      @keydown="onKeyDown"
    />
  </div>
</template>
