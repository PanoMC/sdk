<script module>
  export const view = { path: '/styled' };
</script>

<script>
  let { title = 'Styled', active = false } = $props();
</script>

<div class="style-styled-card" class:is-active={active}>
  <h2 class="style-styled-card__title">{title}</h2>
</div>

<style>
  .style-styled-card {
    --style-gap: 0.5rem;
    padding: var(--style-gap);
    color: var(--pano-color-primary);
    animation: style-pulse 2s ease-in-out infinite;
  }

  .style-styled-card.is-active {
    font-weight: 600;
  }

  @keyframes style-pulse {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
</style>
