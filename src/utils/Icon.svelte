<!--adapted from @joethei's code: https://github.com/joethei/obsidian-rss/blob/master/src/view/IconComponent.svelte-->
<!--adapted from @javalent's code: https://discord.com/channels/686053708261228577/840286264964022302/902949764209987654-->
<script lang="ts">
	import {setIcon} from 'obsidian';
	import {onMount} from 'svelte';

	export let iconName: string = '';

	let iconEl: HTMLElement;

	onMount(() => {
		setIcon(iconEl, iconName);
	});
</script>

<style>
	.icon-wrapper {
		display:  inline-block;
		position: relative;
		width:    18px;
		height:   18px;
	}

	.icon-wrapper > svg {
		position: absolute;
		top:      0;
		bottom:   0;
		left:     0;
		right:    0;
	}
</style>

{#if iconName.length > 0}
	<div class="icon-wrapper" bind:this={iconEl}></div>
{/if}
