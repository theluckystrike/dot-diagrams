# Order service architecture

The checkout path, from the browser to the ledger. Edit the block and the diagram redraws.

```dot
digraph Checkout {
  rankdir=LR;
  node [shape=box style=rounded];
  Browser -> Gateway -> Orders;
  Orders -> Inventory;
  Orders -> Payments -> Ledger;
  Orders -> Mailer [style=dashed label="receipt"];
  Inventory -> Warehouse;
}
```

The same graph works in a block that starts with three backticks and the word graphviz.
