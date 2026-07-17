<script>
  import { createEventDispatcher, onMount } from "svelte";
  
  const dispatch = createEventDispatcher();
  
  export let length = 6;
  export let disabled = false;
  export let isInvalid = false;

  let values = Array(length).fill("");
  let inputs = [];

   function handleInput(index, event) {
     const value = event.target.value;

     if (isInvalid) isInvalid = false;

     // If empty, just update and return
     if (value === "") {
       values[index] = "";
       values = [...values];
       dispatch("change", { code: values.join("") });
       return;
     }

     // Allow only numbers
     if (!/^\d+$/.test(value)) {
       event.target.value = values[index];
       return;
     }
     
     // Take the last character entered
     const char = value.slice(-1);
     values[index] = char;
     values = [...values]; 

     // Focus next
     if (index < length - 1) {
       inputs[index + 1]?.focus();
     }

     const code = values.join("");
     dispatch("change", { code });
     if (code.length === length) {
       dispatch("complete", { code });
     }
   }

   function handlePaste(event) {
     event.preventDefault();
     const pastedData = (event.clipboardData || window.clipboardData).getData("text").slice(0, length);
     if (!/^\d+$/.test(pastedData)) return;

     const chars = pastedData.split("");
     chars.forEach((char, i) => {
       values[i] = char;
     });
     values = [...values]; 
     
     const nextIndex = Math.min(chars.length, length - 1);
     inputs[nextIndex]?.focus();
     
     const code = values.join("");
     dispatch("change", { code });
     if (code.length === length) {
       dispatch("complete", { code });
     }
   }

   function handleKeyDown(index, event) {
     if (event.key === "Backspace") {
       if (values[index]) {
         // If current is full, clear it
         values[index] = "";
       } else if (index > 0) {
         // If current is empty, move to previous and clear it
         inputs[index - 1]?.focus();
         values[index - 1] = "";
       }
       values = [...values];
       dispatch("change", { code: values.join("") });
       event.preventDefault();
       return;
     }

     if (event.key === "ArrowLeft" && index > 0) {
       inputs[index - 1]?.focus();
       event.preventDefault();
       return;
     }

     if (event.key === "ArrowRight" && index < length - 1) {
       inputs[index + 1]?.focus();
       event.preventDefault();
       return;
     }

     if (["Tab", "Delete", "Enter"].includes(event.key)) {
       return;
     }

     if (!/^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey) {
       event.preventDefault();
     }
   }

   onMount(() => {
     setTimeout(() => {
       inputs[0]?.focus();
     }, 50);
   });
 </script>

<div class="d-flex gap-2 justify-content-center">
   {#each values as value, index}
     <input
       bind:this={inputs[index]}
       class="form-control text-center p-0 fs-4 {isInvalid ? 'border-danger' : ''}"
       disabled={disabled}
       inputmode="numeric"
       on:focus={(e) => e.target.select()}
       on:input={(e) => handleInput(index, e)}
       on:keydown={(e) => handleKeyDown(index, e)}
       on:paste={index === 0 ? handlePaste : undefined}
       style="width: 3rem; height: 3.5rem;"
       type="text"
       value={values[index]} />
   {/each}
</div>
