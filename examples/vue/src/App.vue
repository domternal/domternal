<script setup lang="ts">
import { Domternal } from '@domternal/vue';
import { StarterKit, BubbleMenu } from '@domternal/core';

const extensions = [StarterKit, BubbleMenu];
</script>

<template>
  <Domternal :extensions="extensions" content="<p>Hello from Vue!</p>">
    <Domternal.Toolbar />
    <Domternal.Content />
    <Domternal.BubbleMenu />
  </Domternal>
</template>
