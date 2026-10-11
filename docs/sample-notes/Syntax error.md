# A block with a mistake

The third line is missing a target after the arrow.

```dot
digraph G {
  a -> b;
  b -> ;
  c -> a;
}
```
