// sliced(args, start, end): copy of an array-like as a plain Array, like Array.prototype.slice.
module.exports = function sliced(args, start, end) {
  return Array.prototype.slice.call(args, start, end);
};
