<template>
  <div class="tipInfo" @mouseenter="hovering = true" @mouseleave="hovering = false" @click="pinned = !pinned">
    i
  </div>
  <div v-if="showing" class="infoBox" @mouseenter="hovering = true" @mouseleave="hovering = false">
    <p>{{ props.info }}</p>
  </div>
</template>

<script setup>
/**
 * ToolTip component
 * 
 * @component ToolTip
 * @prop {String} info - the information to display when the user clicks or hovers the component.
 * @example
 * <template>
 *     <ToolTip :info="'info to display'" />
 * </template>
 */
import { computed, ref } from 'vue';

const props = defineProps({
    info: {
        type: String,
        required: true
    },
});
// hovering follows the pointer, pinned is a click. A tap on a touch screen fires mouseenter and then click,
// so the click must not undo what the mouseenter showed.
const hovering = ref(false);
const pinned = ref(false);
const showing = computed(() => hovering.value || pinned.value);
</script>

<style scoped>
    .tipInfo{
        background-color: green;
        border: solid lightgreen;
        border-radius: 1.25rem;
        display: inline-grid;
        text-align: center;
        padding-left: 0.3rem;
        padding-right: 0.3rem;
    }
    .infoBox{
        background-color: green;
        border: solid lightgreen;
        border-radius: 1.25rem;
        float:right;
        position: absolute;
        padding:  0.6rem;
        overflow: auto;
        overflow-wrap: break-word;
        z-index: 1;
    }
</style>