<script>
  import { onMount } from "svelte";
  import Grid from "gridjs-svelte";

  let current;
  let resData;
  let data = [];

  onMount(async () => {
    // api -> use your employee API
    const response = await fetch(
      "https://hub.dummyapis.com/employee?noofRecords=6&idStarts=1001"
    );

    resData = await response.json();
    console.log(resData);

    data = resData;
  });
</script>

<!-- // ADD -> a search bar and a refersh icon -->
<!-- <input style=""
type="text"
name="searchbar"
placeholder="Search..."
/> -->

<!-- <i class="mi mi-undo" on:click="{()=> {data = resData}}"></i> -->

<div class ="buttons">
  <button class="{current === 'MTL' ? 'selected' : ''}"
    on:click="{() => current = 'MTL'}">MTL</button>
  <button class="{current === 'MAL' ? 'selected_two' : ''}"
    on:click="{() => current = 'MAL'}" >MAL</button>
  </div>
  
  <div class="refresh">
  <i class="mi mi-undo" on:click="{()=> {data = resData}}"></i>
  </div>

<Grid data={data} 
 search  
 pagination={{ enabled:true, limit: 3 }}
/>

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
  .selected_two {
    background-color: rgb(243, 125, 7);
    color: black;
    font-weight: bold;
    box-shadow: rgba(0, 0, 0, 0.16) 0px 3px 6px, rgba(0, 0, 0, 0.23) 0px 3px 6px;
  }

  .refresh {
    margin-right: 5px;
  }
</style>