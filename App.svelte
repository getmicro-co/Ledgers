<script>
  import { onMount } from "svelte";
  import Grid from "gridjs-svelte";

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

<i class="mi mi-undo" on:click="{()=> {data = resData}}"></i>

<Grid data={data} 
 search  
 pagination={{ enabled:true, limit: 3 }}
 }}
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
</style>