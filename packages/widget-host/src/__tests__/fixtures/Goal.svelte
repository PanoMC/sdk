<script>
  let { data, label = 'goal', count = 0 } = $props();
</script>

<p class="goal">{label}:{data?.value}:{count}</p>
