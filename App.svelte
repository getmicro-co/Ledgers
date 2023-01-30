<script>
  import { onMount } from "svelte";
  import Grid from "gridjs-svelte";
  import { fetchMALData, fetchMTLData } from "./utils/index";
  /**
   * weird things abour gridJs
   * it doesnt seem to read values of coliumns with capital letters
   */
  let current;
  let data = [];

  const handleClick = async (e) => {
    const BTN_NAME = e.target.textContent;
    // console.log(BTN_NAME === "MAL");

    if (BTN_NAME === "MAL") {
      // call MTL FETCH
      data = await fetchMALData();
    } else {
      // call MAL FTECH
      data = await fetchMTLData();
    }
  };
</script>

<div class="buttons">
  <button
    class={current === "MTL" && "selected"}
    on:click={(e) => handleClick(e)}>MTL</button
  >
  <button
    class={current === "MAL" && "selected_two"}
    on:click={async (e) => await handleClick(e)}>MAL</button
  >
</div>

<div class="refresh">
  <i
    class="mi mi-undo"
    on:click={() => {
      // data = resData;
    }}
  />
</div>

<Grid {data} search pagination={{ enabled: true, limit: 3 }} />

<style>
  @import "https://cdn.jsdelivr.net/npm/gridjs/dist/theme/mermaid.min.css";
  /* input{
                  margin:15px;
                  width:170px;
                  height:25px;
                  font-weight:bold;
                  background:#F5F6FA;
                  border-radius:5px;
                  border:1px solid #c4c5c8;
                  outline:none;
                }
                input:hover{
                  background: lightgray;
                  box-shadow: rgba(0, 0, 0, 0.24) 0px 3px 8px;
                } */

  .mi {
    font-size: 1.4rem;
    float: right;
    /* margin-bottom: -40px; */
    cursor: pointer;
    background: #e6e7eb;
    padding: 3px;
    border-radius: 5px;
  }
  .mi:hover {
    box-shadow: rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
      rgba(6, 24, 44, 0.65) 0px 4px 6px -1px,
      rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
  }

  button {
    background-color: white;
    color: black;
    border: 2px solid #555555;
    align-content: center;
    padding: 8px 20px;
    text-align: center;
    text-decoration: none;
    display: inline-block;
    font-size: 14px;
    margin: 10px 3px;
    transition-duration: 0.4s;
    cursor: pointer;
  }

  button:hover {
    background-color: #555555;
    color: white;
  }

  .buttons {
    text-align: center;
  }

  .selected {
    background-color: rgb(245, 71, 71);
    color: black;
    font-weight: bold;
    box-shadow: rgba(0, 0, 0, 0.16) 0px 3px 6px, rgba(0, 0, 0, 0.23) 0px 3px 6px;
  }

  .refresh {
    margin-right: 5px;
  }
</style>
